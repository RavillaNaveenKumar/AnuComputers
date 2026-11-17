import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { CrmCustomRecords } from "@/components/crm-custom-records";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { evaluateUserAuthorization } from "@/lib/authorization";
import { hasStandardRecordStore } from "@/lib/crm-registry";

export default async function NativeRecordPage({ params }: { params: Promise<{ objectId: string; recordId: string }> }) {
  const user = await requireUser();
  const { objectId, recordId } = await params;
  const object = await prisma.crmObject.findFirst({
    where: { id: objectId, objectType: "STANDARD", active: true },
    select: { id: true, name: true, apiName: true },
  });
  if (!object || !hasStandardRecordStore(object.apiName)) notFound();
  const authorization = await evaluateUserAuthorization(user, { objectId: object.id, objectCapability: "canRead" });
  if (!authorization.allowed || !await getNativeCrmRecord(object.apiName, recordId, user)) {
    notFound();
  }
  return <>
    <PageHeader eyebrow={`${object.name.toUpperCase()} RECORD`} title={`${object.name} record`} description="Record details and editable fields follow your app, object, and field permissions." />
    <section className="panel"><CrmCustomRecords
      objectId={object.id}
      native
      singleRecord
      endpoint={`/api/crm-native-records/${object.id}?recordId=${encodeURIComponent(recordId)}`}
    /></section>
  </>;
}
