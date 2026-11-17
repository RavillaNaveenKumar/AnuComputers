import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { dateTime, money } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/app-shell";
import { DeliveryForm, ShipmentForm } from "@/components/workflow-forms";
import { getNativeCrmRecord, listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const [orderReadAuthorization, accountReadAuthorization, quoteReadAuthorization, orderItemReadAuthorization, productReadAuthorization, dispatchAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Quote", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "OrderItem", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { capability: "dispatch:write" }),
  ]);
  const canReadOrder = orderReadAuthorization.allowed;
  let canReadAccount = accountReadAuthorization.allowed;
  let canReadQuote = quoteReadAuthorization.allowed;
  let canReadOrderItems = orderItemReadAuthorization.allowed;
  const canReadProducts = productReadAuthorization.allowed;
  if (!canReadOrder) notFound();
  const [orderFields, accountFields, quoteFields, orderItemFields, shippingAddressFields] = await Promise.all([
    evaluateNativeFieldAuthorizations(user, {
      Order: ["Name", "AccountId", "Status", ...(canReadQuote ? ["QuoteId", "InvoiceReference", "Total"] : [])],
    }),
    canReadAccount ? evaluateNativeFieldAuthorizations(user, { Account: ["Name", "Phone"] }) : Promise.resolve({ allowed: false as const }),
    canReadQuote ? evaluateNativeFieldAuthorizations(user, { Quote: ["Name"] }) : Promise.resolve({ allowed: false as const }),
    canReadOrderItems ? evaluateNativeFieldAuthorizations(user, {
      OrderItem: ["OrderId", "ProductId", "SKU", "Description", "Quantity", ...(canReadQuote ? ["UnitPrice"] : [])],
      ...(canReadProducts ? { Product: ["TrackingType"] } : {}),
    }) : Promise.resolve({ allowed: false as const }),
    evaluateNativeFieldAuthorizations(user, { Order: ["ShippingAddress"] }),
  ]);
  if (!orderFields.allowed) notFound();
  canReadAccount = canReadAccount && accountFields.allowed;
  canReadQuote = canReadQuote && quoteFields.allowed;
  canReadOrderItems = canReadOrderItems && orderItemFields.allowed;
  const canReadShippingAddress = shippingAddressFields.allowed;
  const { id } = await params;
  const [orderRecord, accountIds, orderItemIds, productIds] = await Promise.all([
    getNativeCrmRecord("Order", id, user),
    canReadAccount ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
    canReadOrderItems ? listNativeCrmRecordIds("OrderItem", user) : Promise.resolve([]),
    canReadProducts ? listNativeCrmRecordIds("Product", user) : Promise.resolve([]),
  ]);
  if (!orderRecord || !accountIds.includes(String(orderRecord.data.AccountId))) notFound();
  const order = await prisma.order.findFirst({
    where: { id },
    include: {
      customer: { select: { name: true, phone: true } },
      quote: { select: { id: true, reference: true } },
      items: { where: { id: { in: orderItemIds } }, include: { shipments: { include: { shipment: true } }, units: { include: { replacement: true, replacedUnit: true } } } },
      shipments: {
        include: {
          items: {
            include: { orderItem: true },
          },
        },
      },
    },
  });
  if (!order) notFound();
  const productTracking = canReadProducts && productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, trackingType: true } })
    : [];
  const productTrackingById = new Map(productTracking.map((product) => [product.id, product.trackingType]));
  const pending = order.items.map((item) => ({ id: item.id, label: `${item.skuSnapshot} · ${item.description}`, pending: item.quantity - item.shipments.reduce((sum, line) => sum + line.quantity, 0) })).filter((item) => item.pending > 0);
  const canDispatch = dispatchAuthorization.allowed && canReadOrderItems && order.items.every((item) => productTrackingById.has(item.productId));
  return <>
    <div className="breadcrumb"><Link href="/orders">Orders</Link> / {order.reference}</div>
    <PageHeader eyebrow="ORDER" title={order.reference} description={`${canReadAccount ? order.customer.name : "Restricted account"} · Created ${dateTime(order.createdAt)}`} action={<StatusBadge>{order.status}</StatusBadge>} />
    <div className="detail-grid"><div className="detail-card"><small>Customer</small><strong>{canReadAccount ? <Link href={`/customers/${order.customerId}`} className="record-link">{order.customer.name}</Link> : "Restricted"}</strong><span>{canReadAccount ? order.customer.phone || "" : ""}</span></div>{canReadQuote && <><div className="detail-card"><small>Order total</small><strong>{money(order.total)}</strong><span>{order.invoiceReference ? `Invoice ${order.invoiceReference}` : "No invoice reference"}</span></div><div className="detail-card"><small>Source quote</small><strong>{order.quote ? <Link className="record-link" href={`/quotes/${order.quote.id}`}>{order.quote.reference}</Link> : "Direct order"}</strong></div></>}</div>
    <section className="panel section-spacer"><div className="panel-header"><div><h2>Order lines</h2><p>Dispatched, delivered, and pending quantities</p></div>{canDispatch && <ShipmentForm orderId={order.id} items={pending} />}</div>
      {canReadOrderItems ? <div className="table-wrap"><table className="data-table"><thead><tr><th>SKU / description</th><th>Ordered</th><th>Dispatched</th><th>Delivered</th><th>Pending</th><th>Tracking</th>{canReadQuote && <th>Line total</th>}</tr></thead><tbody>
        {order.items.map((item) => {
          const dispatched = item.shipments.reduce((sum, line) => sum + line.quantity, 0);
          const delivered = item.shipments.reduce((sum, line) => sum + line.delivered, 0);
          return <tr key={item.id}><td><strong>{item.skuSnapshot}</strong><span className="table-sub">{item.description}</span></td><td>{item.quantity}</td><td>{dispatched}</td><td>{delivered}</td><td>{item.quantity - delivered}</td><td>{productTrackingById.get(item.productId) || "Restricted"}</td>{canReadQuote && <td>{money(Number(item.unitPrice) * item.quantity)}</td>}</tr>;
        })}
      </tbody></table></div> : <p className="panel-empty-copy">You do not have permission to read order items.</p>}
    </section>
    {canReadOrderItems && <section className="panel section-spacer"><div className="panel-header"><div><h2>Shipment history</h2><p>Partial deliveries are tracked independently</p></div></div>
      {order.shipments.length ? order.shipments.map((shipment) => <div className="shipment-row" key={shipment.id}><div className="shipment-heading"><div><strong>{shipment.reference}</strong><small>{shipment.carrier || "Carrier not noted"} {shipment.tracking ? `· ${shipment.tracking}` : ""} · {shipment.deliveredAt ? `Delivered ${dateTime(shipment.deliveredAt)}` : `Shipped ${dateTime(shipment.shippedAt)}`}</small></div>
        {dispatchAuthorization.allowed && !shipment.deliveredAt && shipment.items.filter((line) => line.quantity > line.delivered).every((line) => productTrackingById.has(line.orderItem.productId)) && <DeliveryForm shipmentId={shipment.id} items={shipment.items.filter((line) => line.quantity > line.delivered).map((line) => ({ id: line.id, label: `${line.orderItem.skuSnapshot} · ${line.orderItem.description}`, remaining: line.quantity - line.delivered, serialTracked: productTrackingById.get(line.orderItem.productId) === "SERIAL" }))} />}
      </div><div className="shipment-line-summary">{shipment.items.map((line) => <span key={line.id}>{line.orderItem.skuSnapshot}: {line.delivered} / {line.quantity} delivered{line.serials.length ? ` · ${line.serials.join(", ")}` : ""}</span>)}</div></div>) : <p className="panel-empty-copy">No shipments have been created.</p>}
    </section>}
    <section className="panel section-spacer"><div className="panel-header"><div><h2>Purchased-unit history</h2><p>Created when serial-tracked units are delivered</p></div></div>
      {order.items.some((item) => item.units.length) ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Serial</th><th>Warranty start</th><th>Warranty end</th><th>Replacement</th></tr></thead><tbody>{order.items.flatMap((item) => item.units.map((unit) => <tr key={unit.id}><td>{item.description}</td><td>{unit.serial}</td><td>{dateTime(unit.warrantyStart)}</td><td>{unit.warrantyEnd ? dateTime(unit.warrantyEnd) : "Unknown"}</td><td>{unit.replacement ? `Replaced by ${unit.replacement.serial}` : unit.replacedUnit ? `Replacement for ${unit.replacedUnit.serial}` : "—"}</td></tr>))}</tbody></table></div> : <p className="panel-empty-copy">No serialized product units delivered yet.</p>}
    </section>
    {canReadShippingAddress && <div className="customer-contact-list section-spacer"><h2 className="subheading">Shipping address</h2>{order.shippingSnapshot ? <pre className="address-snapshot">{JSON.stringify(order.shippingSnapshot, null, 2)}</pre> : <p className="panel-empty-copy">No shipping address snapshot.</p>}</div>}
  </>;
}
