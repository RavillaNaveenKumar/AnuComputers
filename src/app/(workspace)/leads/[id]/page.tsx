import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { dateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/app-shell";
import { LeadAssignmentForm, LeadConversionForm } from "@/components/lead-controls";
import { LeadActivityForm } from "@/components/workflow-forms";
import { RecordForm } from "@/components/record-form";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { getNativeCrmRecord, listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [readAuthorization, editAuthorization, deleteAuthorization, assignAuthorization, accountAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Lead", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Lead", objectCapability: "canEdit" }),
    evaluateUserAuthorization(user, { objectApiName: "Lead", objectCapability: "canDelete" }),
    evaluateUserAuthorization(user, { capability: "leads:assign" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
  ]);
  if (!readAuthorization.allowed) notFound();
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Lead: ["Name", "Reference", "Email", "Phone", "Status", "Source", "Interest", "EstimatedQuantity", "NextFollowUpAt", "Notes", "ActivityKind", "ActivityNote", "AccountId", "AssigneeId"],
  });
  if (!fieldAuthorization.allowed) notFound();
  const canEditLead = editAuthorization.allowed;
  const canDeleteLead = deleteAuthorization.allowed;
  const leadRecord = await getNativeCrmRecord("Lead", id, user);
  if (!leadRecord) notFound();
  const [accountNameFields, accountContactFields] = await Promise.all([
    accountAuthorization.allowed ? evaluateNativeFieldAuthorizations(user, { Account: ["Name"] }) : Promise.resolve(null),
    accountAuthorization.allowed ? evaluateNativeFieldAuthorizations(user, { Account: ["Phone", "Email"] }) : Promise.resolve(null),
  ]);
  const canReadAccounts = accountAuthorization.allowed && Boolean(accountNameFields?.allowed);
  const canReadAccountContacts = canReadAccounts && Boolean(accountContactFields?.allowed);
  const accountIds = canReadAccounts ? await listNativeCrmRecordIds("Account", user) : [];
  const lead = await prisma.lead.findFirst({ where: { id }, include: { assignee: { select: { name: true } }, customer: { where: { id: { in: accountIds } }, select: { id: true, name: true } }, activities: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } } } });
  if (!lead) notFound();
  const [staff, possibleCustomers] = await Promise.all([
    assignAuthorization.allowed ? prisma.user.findMany({ where: { active: true, role: { in: ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE"] } }, select: { id: true, name: true } }) : Promise.resolve([]),
    lead.status === "QUALIFIED" && canReadAccountContacts ? prisma.customer.findMany({
      where: { id: { in: accountIds }, OR: [
        ...(lead.phone ? [{ phone: lead.phone }] : []),
        ...(lead.email ? [{ email: { equals: lead.email, mode: "insensitive" as const } }] : []),
      ] },
      select: { id: true, name: true, phone: true, email: true },
      take: 8,
    }) : Promise.resolve([]),
  ]);
  const customerOptions = canReadAccounts ? await prisma.customer.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, name: true, phone: true, email: true },
    orderBy: { name: "asc" },
    take: 100,
  }) : [];
  if (!canReadAccountContacts) {
    for (const customer of customerOptions) {
      customer.phone = null;
      customer.email = null;
    }
  }
  if (lead.customer && !customerOptions.some((customer) => customer.id === lead.customer!.id)) {
    customerOptions.unshift({ id: lead.customer.id, name: lead.customer.name, phone: null, email: null });
  }
  return <>
    <div className="breadcrumb"><Link href="/leads">Leads</Link> / {lead.reference}</div>
    <PageHeader eyebrow={lead.reference} title={lead.name} description={`Created ${dateTime(lead.createdAt)} · Source: ${lead.source.replaceAll("_", " ")}`} action={<div className="header-form-actions">
      <StatusBadge>{lead.status}</StatusBadge>
      {canEditLead && <RecordForm title="Edit lead" endpoint={`/api/leads/${id}`} method="PATCH" submitLabel="Save lead" fields={[
        { name: "name", label: "Contact name", required: true, defaultValue: lead.name },
        { name: "email", label: "Email", type: "email", defaultValue: lead.email || "" },
        { name: "phone", label: "Phone", type: "tel", defaultValue: lead.phone || "" },
        { name: "source", label: "Source", required: true, defaultValue: lead.source },
        { name: "interest", label: "Product interest", defaultValue: lead.interest || "" },
        { name: "estimatedQuantity", label: "Estimated quantity", type: "number", required: true, defaultValue: String(lead.estimatedQuantity) },
        ...(lead.status !== "CONVERTED" && lead.status !== "DISQUALIFIED" ? [{ name: "status", label: "Status", type: "select" as const, required: true, defaultValue: lead.status, options: ["NEW", "ASSIGNED", "CONTACTED", "QUALIFIED", "NURTURE", "DISQUALIFIED"].map((status) => ({ label: status.replaceAll("_", " "), value: status })) }] : []),
        { name: "nextFollowUpAt", label: "Next follow-up", type: "date", defaultValue: lead.nextFollowUpAt?.toISOString().slice(0, 10) || "" },
        { name: "notes", label: "Notes", type: "textarea", defaultValue: lead.notes || "" },
      ]} />}
      {canDeleteLead && <DeleteRecordButton endpoint={`/api/leads/${id}`} returnTo="/leads" recordLabel={`lead ${lead.reference}`} />}
    </div>} />
    <div className="detail-grid"><div className="detail-card"><small>Phone</small><strong>{lead.phone || "—"}</strong></div><div className="detail-card"><small>Email</small><strong>{lead.email || "—"}</strong></div><div className="detail-card"><small>Product interest</small><strong>{lead.interest || "—"}</strong></div></div>
    {lead.customer && <div className="linked-record"><strong>{lead.status === "CONVERTED" ? "Converted customer:" : "Linked customer:"}</strong> <Link href={`/customers/${lead.customer.id}`} className="record-link">{lead.customer.name}</Link></div>}
    <div className="detail-grid section-spacer"><div className="detail-card"><small>Estimated quantity</small><strong>{lead.estimatedQuantity}</strong></div><div className="detail-card"><small>Next follow-up</small><strong>{dateTime(lead.nextFollowUpAt)}</strong></div><div className="detail-card"><small>Assigned to</small><strong>{lead.assignee?.name || "Unassigned"}</strong></div></div>
    {assignAuthorization.allowed && <section className="panel section-spacer"><div className="panel-header"><div><h2>Assignment</h2><p>Choose the staff member responsible for the next step</p></div></div><div className="panel-body"><LeadAssignmentForm id={id} assigneeId={lead.assigneeId} staff={staff} /></div></section>}
    {canEditLead && lead.status !== "CONVERTED" && lead.status !== "DISQUALIFIED" && <section className="panel section-spacer"><div className="panel-header"><div><h2>Log follow-up</h2><p>Keep conversation history and next action together</p></div></div><div className="panel-body"><LeadActivityForm leadId={id} /></div></section>}
    {lead.status === "QUALIFIED" && <section className="panel section-spacer"><div className="panel-header"><div><h2>Convert qualified lead</h2><p>Link an existing customer or create a new customer. Potential matches are shown for review; records are never merged automatically.</p></div></div><div className="panel-body"><LeadConversionForm id={id} name={lead.name} email={lead.email} phone={lead.phone} customers={customerOptions} possibleMatches={possibleCustomers} linkedCustomerId={lead.customerId} /></div></section>}
    <section className="panel section-spacer"><div className="panel-header"><div><h2>Activity timeline</h2><p>Previous calls, notes, and follow-ups</p></div></div>
      {lead.activities.length ? <div className="timeline">{lead.activities.map((activity) => <div className="timeline-item" key={activity.id}><span className="timeline-dot" /><div><div className="timeline-title"><strong>{activity.kind.replaceAll("_", " ")}</strong><small>{dateTime(activity.createdAt)} · {activity.author.name}</small></div><p>{activity.note}</p></div></div>)}</div> : <p className="panel-empty-copy">No activity has been logged yet.</p>}
    </section>
  </>;
}
