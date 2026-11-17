import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateUserAuthorization } from "@/lib/authorization";
import { dateTime } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/app-shell";
import { RecordForm } from "@/components/record-form";
import { BusinessSettingsForm } from "@/components/settings-forms";

export default async function SettingsPage() {
  const user = await requireUser();
  const authorization = await evaluateUserAuthorization(user, { capability: "settings:manage" });
  if (!authorization.allowed) redirect("/forbidden");
  const [staff, categories, settings] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, active: true, createdAt: true }, orderBy: { name: "asc" } }),
    prisma.productCategory.findMany({ include: { _count: { select: { products: true } } }, orderBy: { name: "asc" } }),
    prisma.businessSetting.findMany(),
  ]);
  const settingMap = new Map(settings.map((item) => [item.key, item.value]));
  return <>
    <PageHeader eyebrow="ADMINISTRATION" title="Settings" description="Manage staff access, product categories, and business defaults." />
    <section className="panel"><div className="panel-header"><div><h2>Staff accounts</h2><p>Manage user details, roles, activation, sessions, and password setup in CRM Setup.</p></div><Link className="button button-primary" href="/crm-setup">Open user management</Link></div>
      {staff.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Staff member</th><th>Email</th><th>Role & access</th><th>Joined</th></tr></thead><tbody>{staff.map((member) => <tr key={member.id}><td><strong>{member.name}</strong></td><td>{member.email}</td><td>{member.role.replaceAll("_", " ")} · {member.active ? "Active" : "Inactive"}</td><td>{dateTime(member.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No staff accounts" description="Create a staff account from CRM Setup → Users." />}
    </section>
    <section className="panel section-spacer"><div className="panel-header"><div><h2>Product categories</h2><p>Organize catalogue products without removing history.</p></div><RecordForm title="Add category" endpoint="/api/categories" fields={[{ name: "name", label: "Category name", required: true }]} /></div>
      {categories.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Category</th><th>Products</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td><strong>{category.name}</strong></td><td>{category._count.products}</td></tr>)}</tbody></table></div> : <p className="panel-empty-copy">No categories created.</p>}
    </section>
    <section className="panel section-spacer"><div className="panel-header"><div><h2>Business defaults</h2><p>Timezone controls date display. Warranty defaults apply to future products only.</p></div></div><div className="panel-body"><BusinessSettingsForm timezone={settingMap.get("timezone") || process.env.BUSINESS_TIMEZONE || "Asia/Kolkata"} defaultWarrantyMonths={Number(settingMap.get("defaultWarrantyMonths") || 0)} /></div></section>
    <div className="settings-note">Role: <strong>{user.role.replaceAll("_", " ")}</strong>. Keep at least one active Admin account.</div>
  </>;
}
