import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { money } from "@/lib/format";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function QuoteLineItemsPage() {
  const user = await requireUser();
  const authorization = await evaluateUserAuthorization(user, { objectApiName: "QuoteLineItem", objectCapability: "canRead" });
  if (!authorization.allowed) {
    return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to quote line items." /></div>;
  }
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    QuoteLineItem: ["QuoteId", "ProductId", "SKU", "Description", "Quantity", "UnitPrice", "Discount"],
    Quote: ["Name"],
    Account: ["Name"],
    Product: ["ProductCode", "Name"],
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  const [itemIds, quoteIds, accountIds, productIds] = await Promise.all([
    listNativeCrmRecordIds("QuoteLineItem", user),
    listNativeCrmRecordIds("Quote", user),
    listNativeCrmRecordIds("Account", user),
    listNativeCrmRecordIds("Product", user),
  ]);
  const [items, accounts, products] = await Promise.all([
    prisma.quoteItem.findMany({
    where: { id: { in: itemIds }, quoteId: { in: quoteIds } },
    include: {
      quote: { select: { id: true, reference: true, customerId: true } },
    },
    orderBy: { quote: { createdAt: "desc" } },
    take: 500,
    }),
    prisma.customer.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } }),
  ]);
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const productLabels = new Map(products.map((product) => [product.id, `${product.sku} · ${product.name}`]));
  return <>
    <PageHeader eyebrow="SALES" title="Quote Line Items" description="Quotation lines are managed from their parent quote to preserve pricing and totals." />
    <section className="panel">{items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Quote</th><th>Account</th><th>Product</th><th>Description</th><th>Quantity</th><th>Unit price</th><th>Discount</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td><Link className="table-primary" href={`/quotes/${item.quote.id}`}>{item.quote.reference}</Link></td><td>{accountNames.get(item.quote.customerId) || "Restricted"}</td><td>{productLabels.get(item.productId) || "Restricted"}</td><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td><td>{money(item.discount)}</td></tr>)}
    </tbody></table></div> : <EmptyState title="No quote line items" description="Line items will appear here when products are added to quotes." />}</section>
  </>;
}
