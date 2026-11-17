import { PageHeader } from "@/components/app-shell";
import { CrmSetupManager } from "@/components/crm-setup-manager";
import { requireRole } from "@/lib/session";

export default async function CrmSetupPage() {
  await requireRole(["ADMIN"]);
  return <>
    <PageHeader
      eyebrow="ADMINISTRATION"
      title="CRM Setup"
      description="Manage standard and custom objects, permissions, and CRM applications."
    />
    <CrmSetupManager />
  </>;
}
