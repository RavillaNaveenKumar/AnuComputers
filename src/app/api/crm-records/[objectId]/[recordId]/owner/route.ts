import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { evaluateAuthorization } from "@/lib/authorization";
import { filterAccessibleCrmRecords } from "@/lib/crm-record-access";
import { prisma } from "@/lib/prisma";

const schema = z.object({ ownerId: z.string().min(1) });

export async function PATCH(request: Request, context: { params: Promise<{ objectId: string; recordId: string }> }) {
  const { objectId, recordId } = await context.params;
  const authorization = await evaluateAuthorization({ capability: "leads:assign", objectApiName: "Opportunity", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });

  const object = await prisma.crmObject.findFirst({ where: { id: objectId, apiName: "Opportunity", active: true }, select: { id: true } });
  if (!object) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  const [record, input] = await Promise.all([
    prisma.crmRecord.findFirst({ where: { id: recordId, objectId: object.id }, select: { id: true, ownerId: true, data: true } }),
    request.json().then((body) => schema.safeParse(body)).catch(() => null),
  ]);
  if (!record || !(await filterAccessibleCrmRecords(authorization.user, object.id, [record], "edit")).length) {
    return NextResponse.json({ error: "Opportunity not found or you cannot edit it." }, { status: 404 });
  }
  if (!input?.success) return NextResponse.json({ error: "Select a valid owner." }, { status: 400 });
  const owner = await prisma.user.findFirst({ where: { id: input.data.ownerId, active: true }, select: { id: true, name: true } });
  if (!owner) return NextResponse.json({ error: "Select an active user." }, { status: 400 });

  await prisma.crmRecord.update({
    where: { id: record.id },
    data: { ownerId: owner.id, lastModifiedById: authorization.user.id },
  });
  try {
    await audit(authorization.user.id, "OPPORTUNITY_OWNER_CHANGED", "Opportunity", record.id, { previousOwnerId: record.ownerId, ownerId: owner.id });
  } catch (error) {
    console.error("Opportunity owner change audit failed after saving", { recordId, error });
  }
  revalidatePath("/opportunities");
  revalidatePath(`/records/${object.id}/${record.id}`);
  return NextResponse.json({ success: true, owner: { id: owner.id, name: owner.name } });
}
