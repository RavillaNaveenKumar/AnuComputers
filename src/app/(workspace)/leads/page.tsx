import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { evaluateNativeFieldAuthorizations, evaluateUserAuthorization } from "@/lib/authorization";
import { requireUser } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState } from "@/components/app-shell";
import { RecordForm } from "@/components/record-form";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; mine?: string; due?: string }> }) {
  const user = await requireUser();
  const query = await searchParams;
  const [readAuthorization, createAuthorization, assignAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Lead", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Lead", objectCapability: "canCreate" }),
    evaluateUserAuthorization(user, { capability: "leads:assign" }),
  ]);
  const canReadLeads = readAuthorization.allowed;
  let canCreateLeads = createAuthorization.allowed;
  if (!canReadLeads) return <div className="panel"><EmptyState title="Access restricted" description="Your role does not have access to sales leads." /></div>;
  const fieldAuthorization = await evaluateNativeFieldAuthorizations(user, {
    Lead: ["Name", "Reference", "Phone", "Email", "Interest", "EstimatedQuantity", "AssigneeId", "NextFollowUpAt", "Status"],
  });
  if (!fieldAuthorization.allowed) return <div className="panel"><EmptyState title="Access restricted" description={fieldAuthorization.error} /></div>;
  if (canCreateLeads) {
    const createFields = await evaluateNativeFieldAuthorizations(user, {
      Lead: ["Name", "Phone", "Email", "Source", "Interest", "EstimatedQuantity", "NextFollowUpAt", "Notes", ...(assignAuthorization.allowed ? ["AssigneeId"] : [])],
    }, "edit");
    canCreateLeads = createFields.allowed;
  }
  const leadIds = await listNativeCrmRecordIds("Lead", user);
  const where: Prisma.LeadWhereInput = {
    id: { in: leadIds },
    ...(query.mine === "true" ? { assigneeId: user.id } : {}),
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.due === "true" ? { nextFollowUpAt: { lte: new Date() }, status: { notIn: ["CONVERTED", "DISQUALIFIED"] } } : {}),
    ...(query.q ? { OR: [
      { name: { contains: query.q, mode: "insensitive" } },
      { phone: { contains: query.q } },
      { reference: { contains: query.q, mode: "insensitive" } },
    ] } : {}),
  };
  const leads = await prisma.lead.findMany({ where, select: {
    id: true, name: true, reference: true, phone: true, email: true, interest: true,
    estimatedQuantity: true, nextFollowUpAt: true, status: true,
    assignee: { select: { name: true } },
  }, orderBy: [{ nextFollowUpAt: "asc" }, { updatedAt: "desc" }], take: 100 });
  const staff = await prisma.user.findMany({ where: { active: true, role: { in: ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE"] } }, select: { id: true, name: true } });
  return <>
    <PageHeader eyebrow="SALES PIPELINE" title="Leads" description="Own enquiries, log customer conversations, and stay ahead of follow-ups."
      action={canCreateLeads ? <RecordForm title="New lead" endpoint="/api/leads" fields={[
        { name: "name", label: "Contact name", required: true },
        { name: "phone", label: "Phone", type: "tel" },
        { name: "email", label: "Email", type: "email" },
        { name: "source", label: "Source", type: "select", required: true, defaultValue: "PHONE", options: ["PHONE", "WALK_IN", "WEBSITE", "REFERRAL", "OTHER"].map((item) => ({ label: item.replaceAll("_", " "), value: item })) },
        { name: "interest", label: "Product interest", placeholder: "e.g. Business laptops" },
        { name: "estimatedQuantity", label: "Estimated quantity", type: "number", required: true, defaultValue: "1" },
        { name: "nextFollowUpAt", label: "Next follow-up", type: "date" },
        ...(assignAuthorization.allowed ? [{ name: "assigneeId", label: "Assignee", type: "select" as const, options: staff.map((member) => ({ label: member.name, value: member.id })) }] : []),
        { name: "notes", label: "Notes", type: "textarea" },
      ]} /> : undefined}
    />
    <div className="toolbar"><form className="filter-search" method="get"><span>⌕</span><input name="q" defaultValue={query.q} placeholder="Search leads…" aria-label="Search leads" /></form>
      <div className="toolbar-actions"><form method="get" className="filter-form"><select className="toolbar-select" name="status" defaultValue={query.status || ""} aria-label="Filter by status"><option value="">All statuses</option>{["NEW", "ASSIGNED", "CONTACTED", "QUALIFIED", "NURTURE", "DISQUALIFIED", "CONVERTED"].map((status) => <option key={status}>{status}</option>)}</select><button className="button button-small button-outline">Filter</button></form>{user.role !== "SALES_EXECUTIVE" && <Link className={`button button-small ${query.mine === "true" ? "button-primary" : "button-outline"}`} href="/leads?mine=true">My leads</Link>}</div>
    </div>
    <section className="panel">{leads.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Lead</th><th>Contact</th><th>Interest</th><th>Owner</th><th>Next follow-up</th><th>Status</th></tr></thead><tbody>
      {leads.map((lead) => <tr key={lead.id}><td><Link className="table-primary" href={`/leads/${lead.id}`}>{lead.name}</Link><span className="table-sub">{lead.reference}</span></td><td>{lead.phone || "—"}<span className="table-sub">{lead.email || ""}</span></td><td>{lead.interest || "—"}<span className="table-sub">Qty {lead.estimatedQuantity}</span></td><td>{lead.assignee?.name || "Unassigned"}</td><td>{dateTime(lead.nextFollowUpAt)}</td><td><StatusBadge>{lead.status}</StatusBadge></td></tr>)}
    </tbody></table></div> : <EmptyState title="No leads found" description="Create a lead from a phone call, walk-in, website enquiry, or referral." />}</section>
  </>;
}
