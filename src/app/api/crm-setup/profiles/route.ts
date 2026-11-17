import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, isPrismaUniqueError, requireCrmAdmin } from "@/lib/crm-setup-api";

const objectPermissionSchema = z.object({
  objectId: z.string().min(1),
  canCreate: z.boolean(),
  canRead: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  viewAll: z.boolean(),
  modifyAll: z.boolean(),
});
const fieldPermissionSchema = z.object({
  fieldId: z.string().min(1),
  visible: z.boolean(),
  editable: z.boolean(),
}).refine((permission) => !permission.editable || permission.visible, {
  message: "A field must be visible before it can be editable.",
});
const appPermissionSchema = z.object({ appId: z.string().min(1), canAccess: z.boolean() });
const tabPermissionSchema = z.object({
  appId: z.string().min(1),
  objectId: z.string().min(1),
  visibility: z.enum(["DEFAULT_ON", "DEFAULT_OFF", "HIDDEN"]),
});
const uniqueRows = <T extends { objectId?: string; fieldId?: string; appId: string }>(rows: T[], context: z.RefinementCtx) => {
  const keys = rows.map((row) => `${row.appId}:${row.objectId ?? row.fieldId ?? ""}`);
  if (new Set(keys).size !== rows.length) context.addIssue({ code: "custom", message: "Permission entries must be unique." });
};
const saveSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable(),
  allowLogin: z.boolean(),
  objectPermissions: z.array(objectPermissionSchema).max(1000),
  fieldPermissions: z.array(fieldPermissionSchema).max(5000),
  appPermissions: z.array(appPermissionSchema).max(200),
  tabPermissions: z.array(tabPermissionSchema).max(2000),
}).superRefine((input, context) => {
  const objectIds = input.objectPermissions.map(({ objectId }) => objectId);
  const fieldIds = input.fieldPermissions.map(({ fieldId }) => fieldId);
  const appIds = input.appPermissions.map(({ appId }) => appId);
  if (new Set(objectIds).size !== objectIds.length) context.addIssue({ code: "custom", message: "objectId entries must be unique." });
  if (new Set(fieldIds).size !== fieldIds.length) context.addIssue({ code: "custom", message: "fieldId entries must be unique." });
  if (new Set(appIds).size !== appIds.length) context.addIssue({ code: "custom", message: "appId entries must be unique." });
  uniqueRows(input.tabPermissions, context);
});

const profileIncludes = {
  userAssignments: { select: { id: true, name: true, email: true, role: true } },
  objectPermissions: { include: { object: { select: { id: true, name: true, pluralLabel: true, apiName: true } } } },
  fieldPermissions: { include: { field: { select: { id: true, objectId: true, label: true, apiName: true, dataType: true } } } },
  appPermissions: { include: { app: { select: { id: true, key: true, name: true } } } },
  tabPermissions: { include: { app: { select: { id: true, name: true } }, object: { select: { id: true, name: true, pluralLabel: true } } } },
} as const;

export async function GET() {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const [profiles, apps] = await Promise.all([
    prisma.crmProfile.findMany({ include: profileIncludes, orderBy: [{ builtIn: "desc" }, { name: "asc" }] }),
    prisma.crmApp.findMany({
      select: {
        id: true,
        key: true,
        name: true,
        assignments: {
          where: { active: true, object: { active: true } },
          select: { objectId: true, object: { select: { id: true, name: true, pluralLabel: true } } },
          orderBy: { navigationOrder: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  return NextResponse.json({ profiles, apps });
}

export async function POST(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    cloneFromId: z.string().min(1).optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const source = input.data.cloneFromId
    ? await prisma.crmProfile.findUnique({
      where: { id: input.data.cloneFromId },
      include: { objectPermissions: true, fieldPermissions: true, appPermissions: true, tabPermissions: true },
    })
    : null;
  if (input.data.cloneFromId && !source) return NextResponse.json({ error: "The profile to clone does not exist." }, { status: 404 });

  const key = `profile-${input.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "custom"}-${randomUUID().slice(0, 8)}`;
  try {
    const profile = await prisma.$transaction(async (tx) => {
      const created = await tx.crmProfile.create({
        data: {
          key,
          name: input.data.name,
          description: input.data.description ?? source?.description ?? null,
          builtIn: false,
          allowLogin: source?.allowLogin ?? true,
          ...(source ? {
            objectPermissions: { create: source.objectPermissions.map(({ objectId, canCreate, canRead, canEdit, canDelete, viewAll, modifyAll }) => ({ objectId, canCreate, canRead, canEdit, canDelete, viewAll, modifyAll })) },
            fieldPermissions: { create: source.fieldPermissions.map(({ fieldId, visible, editable }) => ({ fieldId, visible, editable })) },
            appPermissions: { create: source.appPermissions.map(({ appId, canAccess }) => ({ appId, canAccess })) },
            tabPermissions: { create: source.tabPermissions.map(({ appId, objectId, visibility }) => ({ appId, objectId, visibility })) },
          } : {}),
        },
      });
      await auditCrmChange(tx, admin.user.id, source ? "PROFILE_CLONED" : "PROFILE_CREATED", "CrmProfile", created.id, {
        name: created.name,
        ...(source ? { clonedFrom: source.id } : {}),
      });
      return tx.crmProfile.findUniqueOrThrow({ where: { id: created.id }, include: profileIncludes });
    });
    return NextResponse.json(profile, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "A profile with that name already exists." }, { status: 409 });
    throw error;
  }
}

export async function PUT(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = saveSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const profile = await prisma.crmProfile.findUnique({ where: { id: input.data.profileId }, select: { id: true, key: true } });
  if (!profile) return NextResponse.json({ error: "The selected profile does not exist." }, { status: 404 });
  if (profile.key === "system-administrator" && !input.data.allowLogin) {
    return NextResponse.json({ error: "System Administrator login cannot be disabled." }, { status: 409 });
  }

  const [objectCount, fieldCount, appCount, totalObjectCount, totalFieldCount, totalAppCount, totalTabCount] = await Promise.all([
    prisma.crmObject.count({ where: { id: { in: input.data.objectPermissions.map(({ objectId }) => objectId) } } }),
    prisma.crmField.count({ where: { id: { in: input.data.fieldPermissions.map(({ fieldId }) => fieldId) } } }),
    prisma.crmApp.count({ where: { id: { in: input.data.appPermissions.map(({ appId }) => appId) } } }),
    prisma.crmObject.count(),
    prisma.crmField.count(),
    prisma.crmApp.count(),
    prisma.crmAppAssignment.count({ where: { active: true, object: { active: true } } }),
  ]);
  if (objectCount !== input.data.objectPermissions.length || fieldCount !== input.data.fieldPermissions.length || appCount !== input.data.appPermissions.length) {
    return NextResponse.json({ error: "One or more selected objects, fields, or applications no longer exist." }, { status: 409 });
  }
  const pairs = input.data.tabPermissions.map(({ appId, objectId }) => ({ appId, objectId }));
  const assignments = pairs.length ? await prisma.crmAppAssignment.findMany({ where: { OR: pairs }, select: { appId: true, objectId: true } }) : [];
  if (assignments.length !== pairs.length || pairs.length !== totalTabCount ||
    input.data.objectPermissions.length !== totalObjectCount || input.data.fieldPermissions.length !== totalFieldCount || input.data.appPermissions.length !== totalAppCount) {
    return NextResponse.json({ error: "Reload the profile; every current object, field, application, and application tab must have a permission entry." }, { status: 409 });
  }
  if (profile.key === "system-administrator") {
    const systemFieldTypes = await prisma.crmField.findMany({
      where: { id: { in: input.data.fieldPermissions.map(({ fieldId }) => fieldId) } },
      select: { id: true, dataType: true },
    });
    const fieldPermissions = new Map(input.data.fieldPermissions.map((permission) => [permission.fieldId, permission]));
    if (!input.data.allowLogin ||
      input.data.objectPermissions.some((permission) => !permission.canCreate || !permission.canRead || !permission.canEdit || !permission.canDelete || !permission.viewAll || !permission.modifyAll) ||
      input.data.appPermissions.some((permission) => !permission.canAccess) ||
      input.data.tabPermissions.some((permission) => permission.visibility !== "DEFAULT_ON") ||
      systemFieldTypes.some(({ id, dataType }) => {
        const permission = fieldPermissions.get(id);
        return !permission?.visible || (dataType === "AUTO_NUMBER" ? permission.editable : !permission.editable);
      })) {
      return NextResponse.json({ error: "System Administrator must retain full access; auto-number fields are read-only." }, { status: 409 });
    }
  }

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmProfile.update({
        where: { id: profile.id },
        data: { name: input.data.name, description: input.data.description, allowLogin: input.data.allowLogin },
      });
      await Promise.all([
        tx.crmProfileObjectPermission.deleteMany({ where: { profileId: profile.id } }),
        tx.crmProfileFieldPermission.deleteMany({ where: { profileId: profile.id } }),
        tx.crmProfileAppPermission.deleteMany({ where: { profileId: profile.id } }),
        tx.crmProfileTabPermission.deleteMany({ where: { profileId: profile.id } }),
      ]);
      if (input.data.objectPermissions.length) await tx.crmProfileObjectPermission.createMany({ data: input.data.objectPermissions.map((permission) => ({ ...permission, profileId: profile.id })) });
      if (input.data.fieldPermissions.length) await tx.crmProfileFieldPermission.createMany({ data: input.data.fieldPermissions.map((permission) => ({ ...permission, profileId: profile.id })) });
      if (input.data.appPermissions.length) await tx.crmProfileAppPermission.createMany({ data: input.data.appPermissions.map((permission) => ({ ...permission, profileId: profile.id })) });
      if (input.data.tabPermissions.length) await tx.crmProfileTabPermission.createMany({ data: input.data.tabPermissions.map((permission) => ({ ...permission, profileId: profile.id })) });
      if (!input.data.allowLogin) await tx.session.deleteMany({ where: { user: { profileId: profile.id } } });
      await auditCrmChange(tx, admin.user.id, "PROFILE_UPDATED", "CrmProfile", profile.id, {
        name: updated.name,
        allowLogin: updated.allowLogin,
        objectPermissions: input.data.objectPermissions.length,
        fieldPermissions: input.data.fieldPermissions.length,
        appPermissions: input.data.appPermissions.length,
      });
      return tx.crmProfile.findUniqueOrThrow({ where: { id: profile.id }, include: profileIncludes });
    });
    return NextResponse.json(saved);
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "A profile with that name already exists." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = z.object({ profileId: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const profile = await prisma.crmProfile.findUnique({
    where: { id: input.data.profileId },
    select: { id: true, key: true, builtIn: true, _count: { select: { userAssignments: true } } },
  });
  if (!profile) return NextResponse.json({ error: "The selected profile does not exist." }, { status: 404 });
  if (profile.builtIn) return NextResponse.json({ error: "Built-in profiles cannot be deleted." }, { status: 409 });
  if (profile._count.userAssignments) return NextResponse.json({ error: "Reassign all users before deleting this profile." }, { status: 409 });
  await prisma.$transaction(async (tx) => {
    await tx.crmProfile.delete({ where: { id: profile.id } });
    await auditCrmChange(tx, admin.user.id, "PROFILE_DELETED", "CrmProfile", profile.id, { key: profile.key });
  });
  return NextResponse.json({ success: true });
}
