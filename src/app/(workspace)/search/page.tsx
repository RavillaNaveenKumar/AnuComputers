import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { PageHeader, EmptyState } from "@/components/app-shell";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const query = q.trim();
  const [accountAuthorization, leadAuthorization, orderAuthorization, caseAuthorization, productAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { capability: "customers:read", objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { capability: "leads:read", objectApiName: "Lead", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { capability: "orders:read", objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { capability: "service:read", objectApiName: "Case", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
  ]);
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    ...(accountAuthorization.allowed ? { Account: ["Name", "Phone", "Email"] } : {}),
    ...(leadAuthorization.allowed ? { Lead: ["Reference", "Name", "Phone", "Status"] } : {}),
    ...(orderAuthorization.allowed ? { Order: ["Name", "InvoiceReference", "Status"] } : {}),
    ...(caseAuthorization.allowed ? { Case: ["UnitId"] } : {}),
    ...(productAuthorization.allowed ? { Product: ["Name"] } : {}),
  });
  if (!fieldAuthorization.allowed) {
    return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  }
  const [accountIds, leadIds, orderIds, productIds] = await Promise.all([
    accountAuthorization.allowed ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
    leadAuthorization.allowed ? listNativeCrmRecordIds("Lead", user) : Promise.resolve([]),
    orderAuthorization.allowed ? listNativeCrmRecordIds("Order", user) : Promise.resolve([]),
    productAuthorization.allowed ? listNativeCrmRecordIds("Product", user) : Promise.resolve([]),
  ]);
  const [customers, leads, orders, serials] = query.length >= 2 ? await Promise.all([
    accountAuthorization.allowed ? prisma.customer.findMany({ where: { AND: [
      { id: { in: accountIds } },
      { OR: [{ name: { contains: query, mode: "insensitive" } }, { phone: { contains: query } }, { email: { contains: query, mode: "insensitive" } }] },
    ] }, select: { id: true, name: true, phone: true, email: true }, take: 8 }) : Promise.resolve([]),
    leadAuthorization.allowed ? prisma.lead.findMany({ where: { id: { in: leadIds }, OR: [{ reference: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }, { phone: { contains: query } }] }, select: { id: true, reference: true, name: true, status: true }, take: 8 }) : Promise.resolve([]),
    orderAuthorization.allowed ? prisma.order.findMany({ where: { AND: [{ id: { in: orderIds } }, { OR: [{ reference: { contains: query, mode: "insensitive" } }, { invoiceReference: { contains: query, mode: "insensitive" } }] }] }, select: { id: true, reference: true, status: true, customerId: true }, take: 8 }) : Promise.resolve([]),
    caseAuthorization.allowed && productAuthorization.allowed ? prisma.purchasedUnit.findMany({ where: { customerId: { in: accountIds }, productId: { in: productIds }, normalizedSerial: { contains: query.replace(/\s+/g, "").toUpperCase() } }, select: { id: true, serial: true, product: { select: { name: true } }, customer: { select: { id: true, name: true } } }, take: 8 }) : Promise.resolve([]),
  ]) : [[], [], [], []];
  const orderCustomerIds = [...new Set(orders.map((order) => order.customerId).filter((id) => accountIds.includes(id)))];
  const orderCustomers = orderCustomerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: orderCustomerIds } }, select: { id: true, name: true } })
    : [];
  const orderCustomerNames = new Map(orderCustomers.map((customer) => [customer.id, customer.name]));
  const total = customers.length + leads.length + orders.length + serials.length;
  return <>
    <PageHeader eyebrow="GLOBAL SEARCH" title="Search results" description={query ? `Results matching “${query}”` : "Enter at least two characters to search records you can access."} />
    {!total ? <section className="panel"><EmptyState title={query.length >= 2 ? "No matching records" : "Search GemNava CRM"} description="Search across permitted customer contacts, assigned leads, order references, and purchased serial numbers." /></section> :
      <div className="search-results">
        {customers.map((customer) => <Link className="search-result" href={`/customers/${customer.id}`} key={`c-${customer.id}`}><strong>{customer.name} <span className="result-kind">Customer</span></strong><p>{customer.phone || ""}{customer.phone && customer.email ? " · " : ""}{customer.email || ""}</p></Link>)}
        {leads.map((lead) => <Link className="search-result" href={`/leads/${lead.id}`} key={`l-${lead.id}`}><strong>{lead.reference} · {lead.name} <span className="result-kind">Lead</span></strong><p>Status: {lead.status.replaceAll("_", " ")}</p></Link>)}
        {orders.map((order) => <Link className="search-result" href={`/orders/${order.id}`} key={`o-${order.id}`}><strong>{order.reference} · {orderCustomerNames.get(order.customerId) || "Restricted"} <span className="result-kind">Order</span></strong><p>Status: {order.status.replaceAll("_", " ")}</p></Link>)}
        {serials.map((unit) => <Link className="search-result" href={`/customers/${unit.customer.id}`} key={`u-${unit.id}`}><strong>{unit.serial} · {unit.product.name} <span className="result-kind">Purchased serial</span></strong><p>Customer: {unit.customer.name}</p></Link>)}
      </div>}
  </>;
}
