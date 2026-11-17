import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { CrmCustomRecords } from "@/components/crm-custom-records";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateUserAuthorization } from "@/lib/authorization";

export default async function CustomObjectPage({ params }: { params: Promise<{ objectId: string }> }) {
  const user = await requireUser();
  const { objectId } = await params;
  const object = await prisma.crmObject.findFirst({ where: { id: objectId, objectType: "CUSTOM", active: true }, select: { id: true, pluralLabel: true, apiName: true } });
  if (!object) notFound();
  const authorization = await evaluateUserAuthorization(user, { objectId: object.id, objectCapability: "canRead" });
  if (!authorization.allowed) notFound();
  return <>
    <PageHeader eyebrow="CUSTOM OBJECT" title={object.pluralLabel} description={`Records for ${object.apiName}. Your Profile and Permission Sets control app and object access.`} />
    <section className="panel"><CrmCustomRecords objectId={object.id} /></section>
  </>;
}
