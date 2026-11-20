import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { evaluateAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { audit } from "@/lib/audit";

const schema = z.object({ ownerId: z.string().min(1) });

export async function PATCH(request: Request, context: { params: Promise<{ objectId: string; recordId: string }> }) {
  const authorization = await evaluateAuthorization({ capability: "leads:assign", objectApiName: "Opportunity", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { objectId, recordId } = await context.params;
  const [object, accessible, input] = await Promise.all([
    prisma.crmObject.findUnique({ where: { id: objectId }, select: { apiName: true } }),
    getNativeCrmRecord("Opportunity", recordId, authorization.user, "edit"),
    request.json().then((body) => schema.safeParse(body)).catch(() => null),
  ]);
  if (object?.apiName !== "Opportunity") return NextResponse.json({ error: "Owner changes are supported for Opportunities only." }, { status: 400 });
  if (!accessible) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  if (!input?.success) return NextResponse.json({ error: "Select a valid owner." }, { status: 400 });
  const owner = await prisma.user.findFirst({ where: { id: input.data.ownerId, active: true }, select: { id: true, name: true } });
  if (!owner) return NextResponse.json({ error: "Select an active user." }, { status: 400 });
  const previous = await prisma.crmRecord.findFirst({ where: { id: recordId, objectId }, select: { ownerId: true } });
  if (!previous) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.crmRecord.update({ where: { id: recordId }, data: { ownerId: owner.id } });
    await writeNativeRecordMetadata(tx, "Opportunity", recordId, authorization.user.id);
  });
  try {
    await audit(authorization.user.id, "OPPORTUNITY_OWNER_CHANGED", "Opportunity", recordId, { previousOwnerId: previous.ownerId, ownerId: owner.id });
  } catch (error) {
    console.error("Opportunity owner change audit failed after saving", { recordId, error });
  }
  revalidatePath("/opportunities");
  revalidatePath(`/records/${objectId}/${recordId}`);
  return NextResponse.json({ success: true, owner: { id: owner.id, name: owner.name } });
}
