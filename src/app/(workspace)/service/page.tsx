import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { dateTime } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState } from "@/components/app-shell";
import { TicketCreateForm } from "@/components/workflow-forms";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function ServicePage({ searchParams }: { searchParams: Promise<{ status?: string; priority?: string; open?: string }> }) {
  const user = await requireUser();
  const query = await searchParams;
  const [readAuthorization, createAuthorization, productAuthorization, accountAuthorization, orderAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Case", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Case", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
  ]);
  const canReadCases = readAuthorization.allowed;
  const canReadAccounts = accountAuthorization.allowed;
  let canCreateCases = createAuthorization.allowed && canReadAccounts;
  if (!canReadCases) return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to service records." /></div>;
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Case: ["CaseNumber", "AccountId", "Subject", "Type", "Priority", "Status", "AssigneeId"],
    ...(canReadAccounts ? { Account: ["Name"] } : {}),
    ...(productAuthorization.allowed ? { Product: ["Name", "ProductCode"] } : {}),
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  const createFields = canCreateCases
    ? await evaluateNativeFieldAuthorizations(user, {
      Account: ["Name"],
      ...(orderAuthorization.allowed ? { Order: ["Name"] } : {}),
      ...(productAuthorization.allowed ? { Product: ["Name", "ProductCode"] } : {}),
    })
    : null;
  canCreateCases = canCreateCases && Boolean(createFields?.allowed);
  const [caseIds, accountIds, orderIds, productIds] = await Promise.all([
    listNativeCrmRecordIds("Case", user),
    canReadAccounts ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
    canCreateCases && orderAuthorization.allowed ? listNativeCrmRecordIds("Order", user) : Promise.resolve([]),
    productAuthorization.allowed ? listNativeCrmRecordIds("Product", user) : Promise.resolve([]),
  ]);
  const [tickets, customers, units, orders, productRecords] = await Promise.all([
    prisma.serviceTicket.findMany({
      where: {
        id: { in: caseIds },
        ...(query.open === "true" ? { status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING"] as never[] } } : {}),
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.priority ? { priority: query.priority as never } : {}),
      },
      include: { unit: true, assignee: { select: { name: true } } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 100,
    }),
    canReadAccounts ? prisma.customer.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }) : Promise.resolve([]),
    canCreateCases ? prisma.purchasedUnit.findMany({ where: { customerId: { in: accountIds }, productId: { in: productIds } }, include: { product: { select: { name: true, sku: true } } }, orderBy: { createdAt: "desc" }, take: 500 }) : Promise.resolve([]),
    canCreateCases ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, reference: true, customerId: true }, orderBy: { createdAt: "desc" }, take: 300 }) : Promise.resolve([]),
    productAuthorization.allowed ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
  const productNames = new Map(productRecords.map((product) => [product.id, product.name]));
  const activeTickets = tickets.filter((ticket) => !["CLOSED", "RESOLVED"].includes(ticket.status));
  const priorityCounts = ["URGENT", "HIGH", "NORMAL", "LOW"].map((priority) => ({ priority, count: activeTickets.filter((ticket) => ticket.priority === priority).length }));
  return <>
    <PageHeader eyebrow="CUSTOMER CARE" title="Service desk" description="Route repairs, warranty questions, and delivery issues to the right owner."
      action={canCreateCases ? <TicketCreateForm customers={customers.map((item) => ({ id: item.id, label: item.name }))} units={units.map((unit) => ({ id: unit.id, customerId: unit.customerId, label: `${unit.product.sku} · ${unit.product.name} · ${unit.serial}` }))} orders={orders.map((order) => ({ id: order.id, customerId: order.customerId, label: order.reference }))} /> : undefined}
    />
    <div className="detail-grid">{priorityCounts.map((item) => <div className="detail-card" key={item.priority}><small>{item.priority} priority · open</small><strong>{item.count}</strong></div>)}</div>
    <div className="toolbar"><form className="filter-form" method="get"><select className="toolbar-select" name="status" defaultValue={query.status || ""} aria-label="Filter by status"><option value="">All statuses</option>{["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"].map((item) => <option key={item}>{item}</option>)}</select><select className="toolbar-select" name="priority" defaultValue={query.priority || ""} aria-label="Filter by priority"><option value="">All priorities</option>{["URGENT", "HIGH", "NORMAL", "LOW"].map((item) => <option key={item}>{item}</option>)}</select><button className="button button-small button-outline">Filter</button></form><span>{tickets.length} tickets</span></div>
    <section className="panel">{tickets.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Ticket</th><th>Customer / product</th><th>Priority</th><th>Owner</th><th>Created</th><th>Status</th></tr></thead><tbody>
      {tickets.map((ticket) => <tr key={ticket.id}><td><Link className="table-primary" href={`/service/${ticket.id}`}>{ticket.reference}</Link><span className="table-sub">{ticket.title}</span></td><td>{customerNames.get(ticket.customerId) || "Restricted"}<span className="table-sub">{ticket.unit ? productNames.has(ticket.unit.productId) ? `${productNames.get(ticket.unit.productId)} · ${ticket.unit.serial}` : "Purchased unit details restricted" : ticket.type.replaceAll("_", " ")}</span></td><td><StatusBadge>{ticket.priority}</StatusBadge></td><td>{ticket.assignee?.name || "Unassigned"}</td><td>{dateTime(ticket.createdAt)}</td><td><StatusBadge>{ticket.status}</StatusBadge></td></tr>)}
    </tbody></table></div> : <EmptyState title="Service queue is clear" description="Open a ticket for a walk-in repair, delivery problem, or product warranty claim." />}</section>
  </>;
}
