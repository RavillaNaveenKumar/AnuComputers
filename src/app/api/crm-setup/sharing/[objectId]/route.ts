import { NextResponse } from "next/server";
import { z } from "zod";
import { hasStandardRecordStore } from "@/lib/crm-registry";
import { auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";
import { isRoleName } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const configSchema = z.object({
  defaultAccess: z.enum(["PRIVATE", "PUBLIC_READ_ONLY", "PUBLIC_READ_WRITE", "CONTROLLED_BY_PARENT"]),
  grantAccessUsingHierarchy: z.boolean(),
  parentRelationshipId: z.string().min(1).nullable(),
});

export async function GET(_request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const [object, config, parentRelationships, hierarchyRoles, storedUsers] = await Promise.all([
    prisma.crmObject.findUnique({ where: { id: objectId }, select: { id: true } }),
    prisma.crmSharingConfig.findUnique({
      where: { objectId },
      include: {
        parentRelationship: {
          include: {
            targetObject: { select: { id: true, name: true, apiName: true, objectType: true } },
            field: { select: { id: true, label: true, apiName: true } },
          },
        },
      },
    }),
    prisma.crmRelationship.findMany({
      where: {
        sourceObjectId: objectId,
        field: { is: { dataType: "LOOKUP", active: true } },
        targetObject: { active: true },
      },
      include: {
        targetObject: { select: { id: true, name: true, apiName: true, objectType: true } },
        field: { select: { id: true, label: true, apiName: true } },
      },
      orderBy: { label: "asc" },
    }),
    prisma.crmHierarchyRole.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { active: true, profile: { allowLogin: true } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!object) return NextResponse.json({ error: "CRM object not found." }, { status: 404 });
  const users = storedUsers.filter(({ role }) => isRoleName(role));
  const validParentRelationships = parentRelationships.filter(({ targetObject }) =>
    targetObject.objectType === "CUSTOM" ||
    (targetObject.objectType === "STANDARD" && !hasStandardRecordStore(targetObject.apiName)));
  return NextResponse.json({
    config,
    parentRelationships: validParentRelationships,
    hierarchyRoles,
    users,
  });
}

export async function PUT(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const input = configSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

  const object = await prisma.crmObject.findUnique({ where: { id: objectId }, select: { id: true, objectType: true, apiName: true } });
  if (!object) return NextResponse.json({ error: "CRM object not found." }, { status: 404 });

  const parentRelationshipId = input.data.parentRelationshipId;
  if (input.data.defaultAccess === "CONTROLLED_BY_PARENT") {
    if (!parentRelationshipId) return NextResponse.json({ error: "Choose a parent lookup relationship." }, { status: 400 });
    const relationship = await prisma.crmRelationship.findUnique({
      where: { id: parentRelationshipId },
      include: {
        field: { select: { dataType: true } },
        targetObject: { select: { apiName: true, objectType: true, active: true } },
      },
    });
    const targetIsRegistryBacked = relationship?.targetObject.active && (
      relationship.targetObject.objectType === "CUSTOM" ||
      (relationship.targetObject.objectType === "STANDARD" && !hasStandardRecordStore(relationship.targetObject.apiName))
    );
    if (!relationship || relationship.sourceObjectId !== object.id || !relationship.field ||
        relationship.field.dataType !== "LOOKUP" || !targetIsRegistryBacked) {
      return NextResponse.json({ error: "Parent-controlled access requires a lookup to another registry-backed object." }, { status: 400 });
    }
  } else if (parentRelationshipId !== null) {
    return NextResponse.json({ error: "A parent relationship is only valid for parent-controlled access." }, { status: 400 });
  }

  const config = await prisma.$transaction(async (tx) => {
    const updated = await tx.crmSharingConfig.upsert({
      where: { objectId: object.id },
      update: {
        defaultAccess: input.data.defaultAccess,
        grantAccessUsingHierarchy: input.data.grantAccessUsingHierarchy,
        parentRelationshipId,
      },
      create: {
        objectId: object.id,
        defaultAccess: input.data.defaultAccess,
        grantAccessUsingHierarchy: input.data.grantAccessUsingHierarchy,
        parentRelationshipId,
      },
    });
    await auditCrmChange(tx, auth.user.id, "RECORD_SHARING_CONFIG_UPDATED", "CrmObject", object.id, {
      defaultAccess: input.data.defaultAccess,
      grantAccessUsingHierarchy: input.data.grantAccessUsingHierarchy,
      parentRelationshipId,
    });
    return updated;
  });
  return NextResponse.json(config);
}
