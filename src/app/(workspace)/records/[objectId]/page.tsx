import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { CrmCustomRecords } from "@/components/crm-custom-records";
import { hasStandardRecordStore } from "@/lib/crm-registry";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateUserAuthorization } from "@/lib/authorization";

export default async function RegistryObjectPage({ params }: { params: Promise<{ objectId: string }> }) {
  const user = await requireUser();
  const { objectId } = await params;
  const object = await prisma.crmObject.findFirst({
    where: { id: objectId, objectType: "STANDARD", active: true },
    select: { id: true, name: true, pluralLabel: true, apiName: true },
  });
  if (!object) notFound();
  const authorization = await evaluateUserAuthorization(user, { objectId: object.id, objectCapability: "canRead" });
  if (!authorization.allowed) notFound();
  return <>
    <PageHeader eyebrow={`${object.name.toUpperCase()} RECORDS`} title={object.pluralLabel} description={`Manage ${object.apiName} records. Object and field permissions control available actions.`} />
    <section className="panel"><CrmCustomRecords
      objectId={object.id}
      native={hasStandardRecordStore(object.apiName)}
      endpoint={hasStandardRecordStore(object.apiName) ? `/api/crm-native-records/${object.id}` : `/api/crm-records/${object.id}`}
    /></section>
  </>;
}
