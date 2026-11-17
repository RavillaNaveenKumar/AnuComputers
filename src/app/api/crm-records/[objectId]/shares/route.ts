import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateAuthorization } from "@/lib/authorization";
import { auditCrmChange } from "@/lib/crm-setup-api";
import { hasStandardRecordStore } from "@/lib/crm-registry";
import { isRoleName } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getNativeCrmRecord, type NativeCrmUser } from "@/lib/native-crm-records";

const shareSchema = z.object({
  recordId: z.string().min(1),
  userId: z.string().min(1),
  access: z.enum(["READ", "EDIT"]),
});

async function getOwnerAuthorizedObject(objectId: string) {
  const authorization = await evaluateAuthorization({ objectId, objectCapability: "canEdit" });
  if (!authorization.allowed) {
    return { response: NextResponse.json({ error: authorization.error }, { status: authorization.status }) };
  }
  const object = await prisma.crmObject.findFirst({
    where: { id: objectId, active: true },
    select: { id: true, apiName: true },
  });
  if (!object) return { response: NextResponse.json({ error: "CRM object not found." }, { status: 404 }) };
  return { user: authorization.user, object, isNative: hasStandardRecordStore(object.apiName) };
}

async function requireRecordOwner(
  user: NativeCrmUser,
  object: { id: string; apiName: string },
  isNative: boolean,
  recordId: string,
) {
  const record = isNative
    ? await getNativeCrmRecord(object.apiName, recordId, user, "edit")
    : await prisma.crmRecord.findFirst({
      where: { id: recordId, objectId: object.id },
      select: { id: true, ownerId: true },
    });
  if (!record) return { response: NextResponse.json({ error: "Record not found." }, { status: 404 }) };
  if (record.ownerId !== user.id && user.role !== "ADMIN") {
    return { response: NextResponse.json({ error: "Only the record owner or an administrator can manage manual shares." }, { status: 403 }) };
  }
  return { record };
}

export async function GET(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await context.params;
  const auth = await getOwnerAuthorizedObject(objectId);
  if ("response" in auth) return auth.response;
  const recordId = z.string().min(1).safeParse(new URL(request.url).searchParams.get("recordId"));
  if (!recordId.success) return NextResponse.json({ error: "Record id is required." }, { status: 400 });
  const owner = await requireRecordOwner(auth.user, auth.object, auth.isNative, recordId.data);
  if ("response" in owner) return owner.response;
  const shares = auth.isNative
    ? await prisma.crmNativeRecordShare.findMany({
      where: { objectId, recordId: owner.record.id },
      include: { user: { select: { id: true, name: true, email: true, active: true } } },
      orderBy: { createdAt: "asc" },
    })
    : await prisma.crmRecordShare.findMany({
      where: { recordId: owner.record.id },
      include: { user: { select: { id: true, name: true, email: true, active: true } } },
      orderBy: { createdAt: "asc" },
    });
  const users = await prisma.user.findMany({
    where: { id: { not: auth.user.id }, active: true, profile: { allowLogin: true } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ shares, users });
}

export async function POST(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await context.params;
  const auth = await getOwnerAuthorizedObject(objectId);
  if ("response" in auth) return auth.response;
  const input = shareSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const owner = await requireRecordOwner(auth.user, auth.object, auth.isNative, input.data.recordId);
  if ("response" in owner) return owner.response;
  if (input.data.userId === auth.user.id) return NextResponse.json({ error: "A record cannot be manually shared with its owner." }, { status: 400 });
  const target = await prisma.user.findFirst({
    where: { id: input.data.userId, active: true, profile: { allowLogin: true } },
    select: { id: true, role: true },
  });
  if (!target || !isRoleName(target.role)) {
    return NextResponse.json({ error: "Choose an active user who is allowed to sign in." }, { status: 400 });
  }

  const share = await prisma.$transaction(async (tx) => {
    const saved = auth.isNative
      ? await tx.crmNativeRecordShare.upsert({
        where: { objectId_recordId_userId: { objectId, recordId: owner.record.id, userId: target.id } },
        update: { access: input.data.access, createdById: auth.user.id },
        create: {
          objectId,
          recordId: owner.record.id,
          userId: target.id,
          createdById: auth.user.id,
          access: input.data.access,
        },
      })
      : await tx.crmRecordShare.upsert({
        where: { recordId_userId: { recordId: owner.record.id, userId: target.id } },
        update: { access: input.data.access, createdById: auth.user.id },
        create: {
          recordId: owner.record.id,
          userId: target.id,
          createdById: auth.user.id,
          access: input.data.access,
        },
      });
    await auditCrmChange(tx, auth.user.id, "MANUAL_RECORD_SHARE_SET", auth.isNative ? auth.object.apiName : "CrmRecord", owner.record.id, {
      userId: target.id,
      access: input.data.access,
    });
    return saved;
  });
  return NextResponse.json(share, { status: 201 });
}

export async function DELETE(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await context.params;
  const auth = await getOwnerAuthorizedObject(objectId);
  if ("response" in auth) return auth.response;
  const input = z.object({ recordId: z.string().min(1), userId: z.string().min(1) })
    .safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const owner = await requireRecordOwner(auth.user, auth.object, auth.isNative, input.data.recordId);
  if ("response" in owner) return owner.response;
  const share = auth.isNative
    ? await prisma.crmNativeRecordShare.findUnique({
      where: { objectId_recordId_userId: { objectId, recordId: owner.record.id, userId: input.data.userId } },
      select: { id: true },
    })
    : await prisma.crmRecordShare.findUnique({
      where: { recordId_userId: { recordId: owner.record.id, userId: input.data.userId } },
      select: { id: true },
    });
  if (!share) return NextResponse.json({ error: "Manual record share not found." }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    if (auth.isNative) await tx.crmNativeRecordShare.delete({ where: { id: share.id } });
    else await tx.crmRecordShare.delete({ where: { id: share.id } });
    await auditCrmChange(tx, auth.user.id, "MANUAL_RECORD_SHARE_REMOVED", auth.isNative ? auth.object.apiName : "CrmRecord", owner.record.id, {
      userId: input.data.userId,
    });
  });
  return NextResponse.json({ deleted: true });
}
