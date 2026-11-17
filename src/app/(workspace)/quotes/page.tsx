import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { money } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState } from "@/components/app-shell";
import { QuoteCreateForm } from "@/components/workflow-forms";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requireUser();
  const query = await searchParams;
  const [readAuthorization, createAuthorization, accountReadAuthorization, productReadAuthorization, orderReadAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Quote", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Quote", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
  ]);
  const canReadQuotes = readAuthorization.allowed;
  let canCreateQuotes = createAuthorization.allowed && accountReadAuthorization.allowed && productReadAuthorization.allowed;
  let canReadAccounts = accountReadAuthorization.allowed;
  let canReadOrders = orderReadAuthorization.allowed;
  if (!canReadQuotes) return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to quotations." /></div>;
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Quote: ["Name", "AccountId", "Status", "Total", "ValidUntil"],
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  const [accountFields, productFields, orderFields] = await Promise.all([
    canReadAccounts ? evaluateNativeFieldAuthorizations(user, { Account: ["Name"] }) : Promise.resolve({ allowed: false as const }),
    canCreateQuotes ? evaluateNativeFieldAuthorizations(user, { Product: ["ProductCode", "Name", "Price"] }) : Promise.resolve({ allowed: false as const }),
    canReadOrders ? evaluateNativeFieldAuthorizations(user, { Order: ["Name"] }) : Promise.resolve({ allowed: false as const }),
  ]);
  canReadAccounts = canReadAccounts && accountFields.allowed;
  canCreateQuotes = canCreateQuotes && accountFields.allowed && productFields.allowed;
  canReadOrders = canReadOrders && orderFields.allowed;
  const [quoteIds, accountIds, productIds, orderIds] = await Promise.all([
    listNativeCrmRecordIds("Quote", user),
    canReadAccounts ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
    canCreateQuotes ? listNativeCrmRecordIds("Product", user) : Promise.resolve([]),
    canReadOrders ? listNativeCrmRecordIds("Order", user) : Promise.resolve([]),
  ]);
  const [quotes, customers, products, accessibleOrders] = await Promise.all([
    prisma.quote.findMany({ where: { AND: [
      { id: { in: quoteIds } },
      ...(query.status ? [{ status: query.status as never }] : []),
      ...(query.q ? [{ OR: [
        { reference: { contains: query.q, mode: "insensitive" as const } },
        ...(canReadAccounts ? [{ customer: { id: { in: accountIds }, name: { contains: query.q, mode: "insensitive" as const } } }] : []),
      ] }] : []),
    ] }, include: {
      _count: { select: { items: true } },
    }, orderBy: { createdAt: "desc" }, take: 100 }),
    canReadAccounts ? prisma.customer.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }) : Promise.resolve([]),
    canCreateQuotes ? prisma.product.findMany({ where: { id: { in: productIds }, active: true }, select: { id: true, name: true, sku: true, unitPrice: true }, orderBy: { name: "asc" }, take: 300 }) : Promise.resolve([]),
    canReadOrders ? prisma.order.findMany({ where: { id: { in: orderIds }, quoteId: { not: null } }, select: { id: true, reference: true, quoteId: true } }) : Promise.resolve([]),
  ]);
  const accountNames = new Map(customers.map((customer) => [customer.id, customer.name]));
  const ordersByQuote = new Map(accessibleOrders.map((order) => [order.quoteId!, order]));
  return <>
    <PageHeader eyebrow="SALES" title="Quotations" description="Create customer quotes and convert accepted offers into orders."
      action={canCreateQuotes ? <QuoteCreateForm customers={customers.map((item) => ({ id: item.id, label: item.name }))} products={products.map((item) => ({ id: item.id, label: `${item.sku} · ${item.name}`, price: item.unitPrice.toString() }))} /> : undefined}
    />
    <div className="toolbar"><form method="get" className="filter-search"><span>⌕</span><input name="q" defaultValue={query.q} aria-label="Search quotations" placeholder="Search reference or customer…" />{query.status && <input type="hidden" name="status" value={query.status} />}</form><div className="toolbar-actions"><span>{quotes.length} quotations</span></div></div>
    <section className="panel">{quotes.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Quotation</th><th>Customer</th><th>Items</th><th>Total</th><th>Valid until</th><th>Status</th><th>Order</th></tr></thead><tbody>
      {quotes.map((quote) => {
        const order = ordersByQuote.get(quote.id);
        return <tr key={quote.id}><td><Link className="table-primary" href={`/quotes/${quote.id}`}>{quote.reference}</Link><span className="table-sub">{quote.createdAt.toLocaleDateString("en-IN")}</span></td><td>{accountNames.get(quote.customerId) || "Restricted"}</td><td>{quote._count.items} line{quote._count.items === 1 ? "" : "s"}</td><td>{money(quote.total)}</td><td>{quote.validUntil?.toLocaleDateString("en-IN") || "—"}</td><td><StatusBadge>{quote.status}</StatusBadge></td><td>{canReadOrders ? order ? <Link className="record-link" href={`/orders/${order.id}`}>{order.reference}</Link> : "—" : "Restricted"}</td></tr>;
      })}
    </tbody></table></div> : <EmptyState title="No quotations yet" description="Create a quote for a customer and add products, quantity, and pricing." />}</section>
  </>;
}
