import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { dateTime, money } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState } from "@/components/app-shell";
import { ShipmentForm, DeliveryForm, DirectOrderForm } from "@/components/workflow-forms";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; dispatch?: string }> }) {
  const user = await requireUser();
  const query = await searchParams;
  const [readAuthorization, createAuthorization, dispatchAuthorization, quoteReadAuthorization, accountReadAuthorization, productReadAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { capability: "dispatch:write" }),
    evaluateUserAuthorization(user, { capability: "quotes:read" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
  ]);
  const canReadOrders = readAuthorization.allowed;
  const canReadAccounts = accountReadAuthorization.allowed;
  const canReadProducts = productReadAuthorization.allowed;
  let canCreateOrders = createAuthorization.allowed && canReadAccounts;
  if (!canReadOrders) return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to orders." /></div>;
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Order: ["Name", "AccountId", "Status", ...(quoteReadAuthorization.allowed ? ["InvoiceReference", "Total"] : [])],
    OrderItem: ["SKU", "Description", "Quantity", "ProductId"],
    ...(canReadProducts ? { Product: ["TrackingType"] } : {}),
    ...(canReadAccounts ? { Account: ["Name"] } : {}),
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  const createFields = canCreateOrders
    ? await evaluateNativeFieldAuthorizations(user, {
      Account: ["Name"],
      Product: ["ProductCode", "Name", "Price"],
    })
    : null;
  canCreateOrders = canCreateOrders && Boolean(createFields?.allowed);
  const [orderIds, customerIds, productIds] = await Promise.all([
    listNativeCrmRecordIds("Order", user),
    canReadAccounts ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
    canReadProducts ? listNativeCrmRecordIds("Product", user) : Promise.resolve([]),
  ]);
  const orderQuery = prisma.order.findMany({
    where: { AND: [
      { id: { in: orderIds } },
      ...(query.dispatch === "pending" ? [{ status: { in: ["OPEN", "PARTIALLY_SHIPPED"] as never[] } }] : []),
      ...(query.q ? [{ OR: [
        { reference: { contains: query.q, mode: "insensitive" as const } },
        { invoiceReference: { contains: query.q, mode: "insensitive" as const } },
        { customer: { id: { in: customerIds }, name: { contains: query.q, mode: "insensitive" as const } } },
      ] }] : []),
    ] },
    include: {
      items: { include: { shipments: true } },
      shipments: {
        include: {
          items: {
            include: {
              orderItem: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  const customerQuery = canReadAccounts
    ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 })
    : Promise.resolve([]);
  const productQuery = canCreateOrders
    ? prisma.product.findMany({ where: { id: { in: productIds }, active: true }, select: { id: true, name: true, sku: true, unitPrice: true }, orderBy: { name: "asc" }, take: 300 })
    : Promise.resolve([]);
  const productTrackingQuery = canReadProducts
    ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, trackingType: true } })
    : Promise.resolve([]);
  const [orders, customers, products, productTracking] = await Promise.all([orderQuery, customerQuery, productQuery, productTrackingQuery]);
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
  const productTrackingById = new Map(productTracking.map((product) => [product.id, product.trackingType]));
  return <>
    <PageHeader eyebrow="FULFILMENT" title="Orders" description="Track customer orders, shipment progress, and serial capture."
      action={canCreateOrders ? <DirectOrderForm customers={customers.map((item) => ({ id: item.id, label: item.name }))} products={products.map((item) => ({ id: item.id, label: `${item.sku} · ${item.name}`, price: item.unitPrice.toString() }))} /> : undefined}
    />
    <div className="toolbar"><form className="filter-search" method="get"><span>⌕</span><input name="q" defaultValue={query.q} placeholder="Search order, customer, invoice…" aria-label="Search orders" />{query.dispatch && <input type="hidden" name="dispatch" value={query.dispatch} />}</form><div className="toolbar-actions"><span>{orders.length} orders</span></div></div>
    <div className="order-list">{orders.length ? orders.map((order) => {
      const shipmentLines = order.items.map((item) => ({
        id: item.id,
        label: `${item.skuSnapshot} · ${item.description}`,
        pending: item.quantity - item.shipments.reduce((sum, line) => sum + line.quantity, 0),
      })).filter((item) => item.pending > 0);
      const canDispatchOrder = dispatchAuthorization.allowed && order.items.every((item) => productTrackingById.has(item.productId));
      return <section className="panel order-card" key={order.id}>
        <div className="order-card-header"><div><Link className="table-primary" href={`/orders/${order.id}`}>{order.reference}</Link><span className="table-sub">{customerNames.get(order.customerId) || "Restricted"} · {dateTime(order.createdAt)}</span></div><div className="order-card-actions"><StatusBadge>{order.status}</StatusBadge>{canDispatchOrder && <ShipmentForm orderId={order.id} items={shipmentLines} />}</div></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>SKU / item</th><th>Ordered</th><th>Dispatched</th><th>Delivered</th><th>Pending</th><th>Unit tracking</th></tr></thead><tbody>
          {order.items.map((item) => {
            const dispatched = item.shipments.reduce((sum, line) => sum + line.quantity, 0);
            const delivered = item.shipments.reduce((sum, line) => sum + line.delivered, 0);
            const trackingType = productTrackingById.get(item.productId);
            return <tr key={item.id}><td><strong>{item.skuSnapshot}</strong><span className="table-sub">{item.description}</span></td><td>{item.quantity}</td><td>{dispatched}</td><td>{delivered}</td><td>{item.quantity - delivered}</td><td>{trackingType ? trackingType === "SERIAL" ? "Serial tracked" : "Quantity tracked" : "Restricted"}</td></tr>;
          })}
        </tbody></table></div>
        <div className="order-card-footer"><span>{quoteReadAuthorization.allowed && <>Total <strong>{money(order.total)}</strong>{order.invoiceReference && ` · Invoice ${order.invoiceReference}`}</>}</span><Link className="text-link" href={`/orders/${order.id}`}>Order details →</Link></div>
        {order.shipments.map((shipment) => <div className="shipment-row" key={shipment.id}>
          <div className="shipment-heading"><div><strong>{shipment.reference}</strong><small>{shipment.carrier || "Carrier not noted"} {shipment.tracking ? `· ${shipment.tracking}` : ""} · {shipment.deliveredAt ? `Delivered ${dateTime(shipment.deliveredAt)}` : "Awaiting delivery"}</small></div>
            {dispatchAuthorization.allowed && !shipment.deliveredAt && shipment.items.filter((line) => line.quantity > line.delivered).every((line) => productTrackingById.has(line.orderItem.productId)) && <DeliveryForm shipmentId={shipment.id} items={shipment.items.filter((line) => line.quantity > line.delivered).map((line) => ({ id: line.id, label: `${line.orderItem.skuSnapshot} · ${line.orderItem.description}`, remaining: line.quantity - line.delivered, serialTracked: productTrackingById.get(line.orderItem.productId) === "SERIAL" }))} />}
          </div>
        </div>)}
      </section>;
    }) : <section className="panel"><EmptyState title="No orders yet" description="Orders will appear here after a quotation is accepted or a direct order is placed." /></section>}</div>
  </>;
}
