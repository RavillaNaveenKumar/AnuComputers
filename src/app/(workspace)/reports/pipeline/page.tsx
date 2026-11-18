import { PageHeader } from "@/components/app-shell";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { filterAccessibleCrmRecords } from "@/lib/crm-record-access";
import { getCrmFieldCapabilities } from "@/lib/crm-app-access";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export default async function PipelineReportPage() {
  const user = await requireRole(["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE"]);
  const opportunity = await prisma.crmObject.findUnique({ where: { apiName: "Opportunity" }, select: { id: true, fields: { where: { apiName: { in: ["Stage", "Amount"] }, active: true }, select: { id: true, apiName: true } } } });
  const fieldAccess = opportunity ? await getCrmFieldCapabilities(user, opportunity.id, opportunity.fields.map((field) => field.id)) : new Map();
  const canRead = (apiName: string) => {
    const field = opportunity?.fields.find((item) => item.apiName === apiName);
    return Boolean(field && fieldAccess.get(field.id)?.canRead);
  };
  const records = opportunity ? await prisma.crmRecord.findMany({ where: { objectId: opportunity.id }, select: { id: true, ownerId: true, data: true }, orderBy: { updatedAt: "desc" }, take: 5000 }) : [];
  const accessible = opportunity ? await filterAccessibleCrmRecords(user, opportunity.id, records, "read") : [];
  const grouped = new Map<string, { count: number; amount: number }>();
  for (const record of accessible) {
    const data = record.data as Record<string, unknown>;
    const stage = canRead("Stage") ? (typeof data.Stage === "string" && data.Stage ? data.Stage : "Unstaged") : "Restricted stage";
    const current = grouped.get(stage) ?? { count: 0, amount: 0 };
    current.count += 1;
    if (canRead("Amount")) current.amount += typeof data.Amount === "number" ? data.Amount : Number(data.Amount) || 0;
    grouped.set(stage, current);
  }
  const rows = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = rows.reduce((sum, [, values]) => sum + values.amount, 0);
  return <>
    <PageHeader eyebrow="SALES REPORT" title="Pipeline by stage" description="Opportunity count and amount, grouped by the current stage." />
    <section className="panel">
      <div className="crm-panel-heading"><div><h2>Open and closed opportunities</h2><p>{accessible.length} visible records · total {money.format(total)}</p></div></div>
      <div className="crm-custom-record-table-wrap"><table className="crm-custom-record-table"><thead><tr><th>Stage</th><th>Opportunities</th><th>Pipeline amount</th></tr></thead><tbody>
        {rows.map(([stage, values]) => <tr key={stage}><td>{stage}</td><td>{values.count}</td><td>{money.format(values.amount)}</td></tr>)}
        {!rows.length && <tr><td colSpan={3} className="crm-custom-empty">No accessible opportunities yet.</td></tr>}
        {rows.length > 0 && <tr><th>Total</th><th>{accessible.length}</th><th>{money.format(total)}</th></tr>}
      </tbody></table></div>
    </section>
  </>;
}
