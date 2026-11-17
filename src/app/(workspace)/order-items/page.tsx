import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { money } from "@/lib/format";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function OrderItemsPage() {
  const user = await requireUser();
  const authorization = await evaluateUserAuthorization(user, { objectApiName: "OrderItem", objectCapability: "canRead" });
  if (!authorization.allowed) {
    return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to order items." /></div>;
  }
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    OrderItem: ["OrderId", "ProductId", "SKU", "Description", "Quantity", "UnitPrice"],
    Order: ["Name"],
    Account: ["Name"],
    Product: ["ProductCode", "Name"],
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  const [itemIds, orderIds, accountIds, productIds] = await Promise.all([
    listNativeCrmRecordIds("OrderItem", user),
    listNativeCrmRecordIds("Order", user),
    listNativeCrmRecordIds("Account", user),
    listNativeCrmRecordIds("Product", user),
  ]);
  const [items, accounts, products] = await Promise.all([
    prisma.orderItem.findMany({
    where: { id: { in: itemIds }, orderId: { in: orderIds } },
    include: {
      order: { select: { id: true, reference: true, customerId: true } },
      shipments: { select: { quantity: true, delivered: true } },
    },
    orderBy: { order: { createdAt: "desc" } },
    take: 500,
    }),
    prisma.customer.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } }),
  ]);
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const productLabels = new Map(products.map((product) => [product.id, `${product.sku} · ${product.name}`]));
  return <>
    <PageHeader eyebrow="FULFILMENT" title="Order Items" description="Order items are managed from their parent order to preserve shipping and inventory history." />
    <section className="panel">{items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Account</th><th>Product</th><th>Description</th><th>Quantity</th><th>Shipped</th><th>Unit price</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td><Link className="table-primary" href={`/orders/${item.order.id}`}>{item.order.reference}</Link></td><td>{accountNames.get(item.order.customerId) || "Restricted"}</td><td>{productLabels.get(item.productId) || "Restricted"}</td><td>{item.description}</td><td>{item.quantity}</td><td>{item.shipments.reduce((sum, shipment) => sum + shipment.quantity, 0)}</td><td>{money(item.unitPrice)}</td></tr>)}
    </tbody></table></div> : <EmptyState title="No order items" description="Items will appear here when products are added to orders." />}</section>
  </>;
}
