import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { dateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/app-shell";
import { ReplacementForm, TicketUpdateForm } from "@/components/workflow-forms";
import { getNativeCrmRecord, listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const [caseReadAuthorization, caseEditAuthorization, orderReadAuthorization, accountReadAuthorization, productReadAuthorization, assignAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Case", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Case", objectCapability: "canEdit" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { capability: "service:assign" }),
  ]);
  const canReadCase = caseReadAuthorization.allowed;
  const canEditCase = caseEditAuthorization.allowed;
  let canReadAccount = accountReadAuthorization.allowed;
  let canReadProduct = productReadAuthorization.allowed;
  if (!canReadCase) notFound();
  const [caseFields, accountFields, productFields, orderFields] = await Promise.all([
    evaluateNativeFieldAuthorizations(user, {
      Case: ["CaseNumber", "AccountId", "OrderId", "UnitId", "Subject", "Description", "Type", "Priority", "Status", "WaitingReason", "Diagnosis", "PartsUsedNotes", "WarrantyDecision", "Chargeable", "CustomerApproved", "ResolutionNote", "HandoverNotes", "AssigneeId"],
      CaseComment: ["CaseId", "AuthorId", "Type", "Comment", "CreatedAt"],
    }),
    canReadAccount ? evaluateNativeFieldAuthorizations(user, { Account: ["Name", "Phone", "Email"] }) : Promise.resolve({ allowed: false as const }),
    canReadProduct ? evaluateNativeFieldAuthorizations(user, { Product: ["Name", "ProductCode", "TrackingType"] }) : Promise.resolve({ allowed: false as const }),
    orderReadAuthorization.allowed ? evaluateNativeFieldAuthorizations(user, { Order: ["Name", "Status"] }) : Promise.resolve({ allowed: false as const }),
  ]);
  if (!caseFields.allowed) notFound();
  canReadAccount = canReadAccount && accountFields.allowed;
  canReadProduct = canReadProduct && productFields.allowed;
  const { id } = await params;
  const caseRecord = await getNativeCrmRecord("Case", id, user);
  if (!caseRecord || !await getNativeCrmRecord("Account", String(caseRecord.data.AccountId), user)) notFound();
  const ticket = await prisma.serviceTicket.findFirst({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      unit: { include: { product: true, replacedUnit: true, replacement: true } },
      assignee: { select: { id: true, name: true } },
      updates: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!ticket) notFound();
  const relatedOrderRecord = ticket.orderId && orderReadAuthorization.allowed && orderFields.allowed
    ? await getNativeCrmRecord("Order", ticket.orderId, user)
    : null;
  const productIds = canReadProduct ? await listNativeCrmRecordIds("Product", user) : [];
  const canReadTicketProduct = canReadProduct && (!ticket.unit || productIds.includes(ticket.unit.product.id));
  const [assignees, products] = await Promise.all([
    assignAuthorization.allowed ? prisma.user.findMany({ where: { active: true, role: { in: ["SERVICE_AGENT", "TECHNICIAN"] } }, select: { id: true, name: true } }) : Promise.resolve([]),
    canEditCase && canReadProduct
      ? prisma.product.findMany({ where: { id: { in: productIds }, active: true, trackingType: "SERIAL" }, select: { id: true, name: true, sku: true, unitPrice: true }, orderBy: { name: "asc" }, take: 300 })
      : Promise.resolve([]),
  ]);
  const warranty = !canReadTicketProduct || !ticket.unit?.warrantyEnd ? "Unknown" : ticket.unit.warrantyEnd >= new Date() ? "Active" : "Expired";
  return <>
    <div className="breadcrumb"><Link href="/service">Service</Link> / {ticket.reference}</div>
    <PageHeader eyebrow={`SERVICE TICKET · ${ticket.type}`} title={ticket.title} description={`Opened ${dateTime(ticket.createdAt)} · Customer: ${canReadAccount ? ticket.customer.name : "Restricted"}`} action={<><StatusBadge>{ticket.priority}</StatusBadge><StatusBadge>{ticket.status}</StatusBadge></>} />
    <div className="detail-grid"><div className="detail-card"><small>Customer</small><strong>{canReadAccount ? <Link href={`/customers/${ticket.customer.id}`} className="record-link">{ticket.customer.name}</Link> : "Restricted"}</strong><span>{canReadAccount ? ticket.customer.phone || ticket.customer.email || "" : ""}</span></div><div className="detail-card"><small>Purchased product</small><strong>{ticket.unit ? canReadTicketProduct ? <Link href={`/products/${ticket.unit.product.id}`} className="record-link">{ticket.unit.product.name}</Link> : "Restricted" : "Walk-in / no unit linked"}</strong><span>{ticket.unit && canReadTicketProduct ? `Serial ${ticket.unit.serial}` : ""}</span></div><div className="detail-card"><small>Warranty status</small><strong>{warranty}</strong><span>{ticket.unit?.warrantyEnd && canReadTicketProduct ? `Through ${dateTime(ticket.unit.warrantyEnd)}` : "No warranty dates on record"}</span></div></div>
    <div className="detail-grid section-spacer"><div className="detail-card"><small>Assigned to</small><strong>{ticket.assignee?.name || "Unassigned"}</strong></div><div className="detail-card"><small>Coverage decision</small><strong>{ticket.warrantyDecision || "Not reviewed"}</strong></div><div className="detail-card"><small>Chargeable repair</small><strong>{ticket.chargeable ? `Yes · Customer ${ticket.customerApproved ? "approved" : "approval pending"}` : "Not marked chargeable"}</strong></div></div>
    <section className="panel section-spacer"><div className="panel-header"><div><h2>Issue details</h2><p>{relatedOrderRecord ? <>Related order <Link href={`/orders/${relatedOrderRecord.id}`} className="record-link">{String(relatedOrderRecord.data.Name)}</Link></> : ticket.orderId ? <strong>Restricted</strong> : "No order linked"}</p></div></div><div className="panel-body"><p className="body-copy">{ticket.description}</p>{ticket.waitingReason && <p className="inline-notice"><strong>Waiting on:</strong> {ticket.waitingReason}</p>}{ticket.diagnosis && <p className="body-copy"><strong>Diagnosis:</strong> {ticket.diagnosis}</p>}{ticket.partsUsedNotes && <p className="body-copy"><strong>Parts used:</strong> {ticket.partsUsedNotes}</p>}{ticket.resolutionNote && <p className="body-copy"><strong>Resolution:</strong> {ticket.resolutionNote}</p>}{ticket.handoverNotes && <p className="body-copy"><strong>Handover:</strong> {ticket.handoverNotes}</p>}</div></section>
    {canEditCase && ticket.status !== "CLOSED" && <section className="panel section-spacer"><div className="panel-header"><div><h2>Update repair</h2><p>Record diagnosis, assignment, approval, status, and resolution</p></div></div><div className="panel-body">{ticket.status === "ASSIGNED" && !ticket.assigneeId && <p className="inline-notice" role="status">This case has no assignee. Assign a service agent or technician, or reset its status to New.</p>}<TicketUpdateForm ticketId={id} currentStatus={ticket.status} hasAssignee={Boolean(ticket.assigneeId)} assignees={assignees.map((item) => ({ id: item.id, label: item.name }))} /></div></section>}
    {ticket.unit && ticket.unit.product.trackingType === "SERIAL" && !ticket.unit.replacement && canEditCase && canReadTicketProduct && <section className="panel section-spacer"><div className="panel-header"><div><h2>Replacement history</h2><p>Keep old and replacement serial numbers linked to this customer history.</p></div><ReplacementForm ticketId={ticket.id} products={products.map((item) => ({ id: item.id, label: `${item.sku} · ${item.name}`, price: item.unitPrice.toString() }))} /></div></section>}
    {ticket.unit && canReadTicketProduct && (ticket.unit.replacedUnit || ticket.unit.replacement) && <section className="panel section-spacer"><div className="panel-header"><div><h2>Replacement chain</h2><p>Original purchase history is retained.</p></div></div><div className="panel-body">{ticket.unit.replacedUnit && <p className="body-copy">Replacement unit <strong>{ticket.unit.serial}</strong> replaced original serial <strong>{ticket.unit.replacedUnit.serial}</strong>.</p>}{ticket.unit.replacement && <p className="body-copy">Original serial <strong>{ticket.unit.serial}</strong> has replacement serial <strong>{ticket.unit.replacement.serial}</strong>.</p>}</div></section>}
    <section className="panel section-spacer"><div className="panel-header"><div><h2>Ticket timeline</h2><p>Updates and handoff history</p></div></div>
      {ticket.updates.length ? <div className="timeline">{ticket.updates.map((update) => <div className="timeline-item" key={update.id}><span className="timeline-dot" /><div><div className="timeline-title"><strong>{update.kind.replaceAll("_", " ")}</strong><small>{dateTime(update.createdAt)} · {update.author.name}</small></div><p>{update.note}</p></div></div>)}</div> : <p className="panel-empty-copy">No updates have been recorded.</p>}
    </section>
  </>;
}
