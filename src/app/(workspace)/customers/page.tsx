import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { PageHeader, EmptyState } from "@/components/app-shell";
import { RecordForm } from "@/components/record-form";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q = "" } = await searchParams;
  const [accountRead, accountCreate, quoteRead, orderRead, caseRead] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { objectApiName: "Quote", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Case", objectCapability: "canRead" }),
  ]);
  const canReadAccounts = accountRead.allowed;
  let canCreateAccounts = accountCreate.allowed;
  const canReadQuotes = quoteRead.allowed;
  const canReadOrders = orderRead.allowed;
  const canReadCases = caseRead.allowed;
  if (!canReadAccounts) return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to customer records." /></div>;
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Account: ["Name", "Type", "Phone", "Email"],
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  if (canCreateAccounts) {
    const createFields = await evaluateNativeFieldAuthorizations(user, {
      Account: ["Name", "Type", "Phone", "Email", "TaxId", "Notes"],
    }, "edit");
    canCreateAccounts = createFields.allowed;
  }
  const [accountIds, quoteIds, orderIds, caseIds] = await Promise.all([
    listNativeCrmRecordIds("Account", user),
    canReadQuotes ? listNativeCrmRecordIds("Quote", user) : Promise.resolve([]),
    canReadOrders ? listNativeCrmRecordIds("Order", user) : Promise.resolve([]),
    canReadCases ? listNativeCrmRecordIds("Case", user) : Promise.resolve([]),
  ]);
  const customers = await prisma.customer.findMany({
    where: { AND: [{ id: { in: accountIds } }, ...(q ? [{ OR: [
      { name: { contains: q, mode: "insensitive" as const } },
      { phone: { contains: q } },
      { email: { contains: q, mode: "insensitive" as const } },
    ] }] : [])] },
    select: { id: true, name: true, phone: true, email: true, kind: true, createdAt: true, _count: { select: {
      quotes: { where: { id: { in: quoteIds } } },
      orders: { where: { id: { in: orderIds } } },
      tickets: { where: { id: { in: caseIds } } },
    } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return <>
    <PageHeader eyebrow="RELATIONSHIPS" title="Customers" description="Keep customer contacts, orders, and service history together."
      action={canCreateAccounts ? <RecordForm title="New customer" endpoint="/api/customers" fields={[
        { name: "name", label: "Customer name", required: true },
        { name: "kind", label: "Customer type", type: "select", required: true, defaultValue: "BUSINESS", options: [{ label: "Business", value: "BUSINESS" }, { label: "Individual", value: "INDIVIDUAL" }] },
        { name: "phone", label: "Phone", type: "tel" },
        { name: "email", label: "Email", type: "email" },
        { name: "taxId", label: "Tax ID" },
        { name: "notes", label: "Notes", type: "textarea" },
      ]} /> : undefined}
    />
    <div className="toolbar"><form className="filter-search" method="get"><span>⌕</span><input name="q" defaultValue={q} aria-label="Search customers" placeholder="Search customer records…" /></form><div className="toolbar-actions"><span className="muted-count">{customers.length} customers</span></div></div>
    <section className="panel">
      {customers.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Customer</th><th>Contact</th><th>Type</th><th>Quotes</th><th>Orders</th><th>Tickets</th></tr></thead><tbody>
        {customers.map((customer) => <tr key={customer.id}>
          <td><Link className="table-primary" href={`/customers/${customer.id}`}>{customer.name}</Link><span className="table-sub">Added {customer.createdAt.toLocaleDateString("en-IN")}</span></td>
          <td><strong>{customer.phone || "—"}</strong><span className="table-sub">{customer.email || "No email"}</span></td>
            <td>{customer.kind === "BUSINESS" ? "Business" : "Individual"}</td><td>{canReadQuotes ? customer._count.quotes : "—"}</td><td>{canReadOrders ? customer._count.orders : "—"}</td><td>{canReadCases ? customer._count.tickets : "—"}</td>
        </tr>)}
      </tbody></table></div> : <EmptyState title="No customers yet" description="Add a customer to start tracking quotes, orders, and service history." />}
    </section>
  </>;
}
