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
  canRead: z.boolean(),
  canEdit: z.boolean(),
}).refine((permission) => !permission.canEdit || permission.canRead, {
  message: "A field must be readable before it can be editable.",
});
const appPermissionSchema = z.object({ appId: z.string().min(1), canAccess: z.boolean() });
const tabPermissionSchema = z.object({
  appId: z.string().min(1),
  objectId: z.string().min(1),
  visibility: z.enum(["DEFAULT_ON", "DEFAULT_OFF"]),
});
const saveSchema = z.object({
  permissionSetId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable(),
  userIds: z.array(z.string().min(1)).max(5000),
  objectPermissions: z.array(objectPermissionSchema).max(1000),
  fieldPermissions: z.array(fieldPermissionSchema).max(5000),
  appPermissions: z.array(appPermissionSchema).max(200),
  tabPermissions: z.array(tabPermissionSchema).max(2000),
}).superRefine((input, context) => {
  for (const [label, ids] of [
    ["userId", input.userIds],
    ["objectId", input.objectPermissions.map(({ objectId }) => objectId)],
    ["fieldId", input.fieldPermissions.map(({ fieldId }) => fieldId)],
    ["appId", input.appPermissions.map(({ appId }) => appId)],
  ] as const) {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: `${label} entries must be unique.` });
  }
  const tabKeys = input.tabPermissions.map(({ appId, objectId }) => `${appId}:${objectId}`);
  if (new Set(tabKeys).size !== tabKeys.length) context.addIssue({ code: "custom", message: "Tab permission entries must be unique." });
});

const permissionSetIncludes = {
  assignments: { include: { user: { select: { id: true, name: true, email: true, role: true, active: true } } } },
  objectPermissions: { include: { object: { select: { id: true, name: true, pluralLabel: true, apiName: true } } } },
  fieldPermissions: { include: { field: { select: { id: true, objectId: true, label: true, apiName: true, dataType: true } } } },
  appPermissions: { include: { app: { select: { id: true, key: true, name: true } } } },
  tabPermissions: { include: { app: { select: { id: true, name: true } }, object: { select: { id: true, name: true, pluralLabel: true } } } },
} as const;

export async function GET() {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const [permissionSets, apps, objects, users] = await Promise.all([
    prisma.crmPermissionSet.findMany({ include: permissionSetIncludes, orderBy: { name: "asc" } }),
    prisma.crmApp.findMany({
      where: { active: true },
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
    prisma.crmObject.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        pluralLabel: true,
        apiName: true,
        fields: {
          where: { active: true },
          select: { id: true, label: true, apiName: true, dataType: true },
          orderBy: { position: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true, profile: { select: { name: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  ]);
  return NextResponse.json({ permissionSets, apps, objects, users });
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
    ? await prisma.crmPermissionSet.findUnique({
      where: { id: input.data.cloneFromId },
      include: { objectPermissions: true, fieldPermissions: true, appPermissions: true, tabPermissions: true },
    })
    : null;
  if (input.data.cloneFromId && !source) return NextResponse.json({ error: "The permission set to clone does not exist." }, { status: 404 });

  const key = `permission-set-${input.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "custom"}-${randomUUID().slice(0, 8)}`;
  try {
    const permissionSet = await prisma.$transaction(async (tx) => {
      const created = await tx.crmPermissionSet.create({
        data: {
          key,
          name: input.data.name,
          description: input.data.description ?? source?.description ?? null,
          ...(source ? {
            objectPermissions: { create: source.objectPermissions.map(({ objectId, canCreate, canRead, canEdit, canDelete, viewAll, modifyAll }) => ({ objectId, canCreate, canRead, canEdit, canDelete, viewAll, modifyAll })) },
            fieldPermissions: { create: source.fieldPermissions.map(({ fieldId, canRead, canEdit }) => ({ fieldId, canRead, canEdit })) },
            appPermissions: { create: source.appPermissions.map(({ appId, canAccess }) => ({ appId, canAccess })) },
            tabPermissions: { create: source.tabPermissions.map(({ appId, objectId, visibility }) => ({ appId, objectId, visibility })) },
          } : {}),
        },
      });
      await auditCrmChange(tx, admin.user.id, source ? "PERMISSION_SET_CLONED" : "PERMISSION_SET_CREATED", "CrmPermissionSet", created.id, {
        name: created.name,
        ...(source ? { clonedFrom: source.id } : {}),
      });
      return tx.crmPermissionSet.findUniqueOrThrow({ where: { id: created.id }, include: permissionSetIncludes });
    });
    return NextResponse.json(permissionSet, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "A permission set with that name already exists." }, { status: 409 });
    throw error;
  }
}

export async function PUT(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = saveSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const permissionSet = await prisma.crmPermissionSet.findUnique({ where: { id: input.data.permissionSetId }, select: { id: true } });
  if (!permissionSet) return NextResponse.json({ error: "The selected permission set does not exist." }, { status: 404 });

  const [objectCount, fieldCount, appCount, totalObjectCount, totalFieldCount, totalAppCount, totalTabCount, userCount, activeUserCount, existingInactiveAssignments] = await Promise.all([
    prisma.crmObject.count({ where: { active: true, id: { in: input.data.objectPermissions.map(({ objectId }) => objectId) } } }),
    prisma.crmField.count({ where: { active: true, id: { in: input.data.fieldPermissions.map(({ fieldId }) => fieldId) }, object: { active: true } } }),
    prisma.crmApp.count({ where: { active: true, id: { in: input.data.appPermissions.map(({ appId }) => appId) } } }),
    prisma.crmObject.count({ where: { active: true } }),
    prisma.crmField.count({ where: { active: true, object: { active: true } } }),
    prisma.crmApp.count({ where: { active: true } }),
    prisma.crmAppAssignment.count({ where: { active: true, app: { active: true }, object: { active: true } } }),
    prisma.user.count({ where: { id: { in: input.data.userIds } } }),
    prisma.user.count({ where: { id: { in: input.data.userIds }, active: true } }),
    prisma.crmPermissionSetAssignment.findMany({
      where: { permissionSetId: permissionSet.id, userId: { in: input.data.userIds }, user: { active: false } },
      select: { userId: true },
    }),
  ]);
  if (objectCount !== input.data.objectPermissions.length || fieldCount !== input.data.fieldPermissions.length ||
    appCount !== input.data.appPermissions.length || userCount !== input.data.userIds.length) {
    return NextResponse.json({ error: "One or more selected users, objects, fields, or applications no longer exist." }, { status: 409 });
  }
  if (activeUserCount + existingInactiveAssignments.length !== input.data.userIds.length) {
    return NextResponse.json({ error: "Permission Sets cannot be newly assigned to inactive users." }, { status: 409 });
  }
  const pairs = input.data.tabPermissions.map(({ appId, objectId }) => ({ appId, objectId }));
  const assignments = pairs.length ? await prisma.crmAppAssignment.findMany({
    where: { active: true, app: { active: true }, object: { active: true }, OR: pairs },
    select: { appId: true, objectId: true },
  }) : [];
  if (assignments.length !== pairs.length || pairs.length !== totalTabCount ||
    input.data.objectPermissions.length !== totalObjectCount || input.data.fieldPermissions.length !== totalFieldCount ||
    input.data.appPermissions.length !== totalAppCount) {
    return NextResponse.json({ error: "Reload the permission set; every active object, field, application, and application tab must have a permission entry." }, { status: 409 });
  }

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmPermissionSet.update({
        where: { id: permissionSet.id },
        data: { name: input.data.name, description: input.data.description },
      });
      await Promise.all([
        tx.crmPermissionSetObjectPermission.deleteMany({ where: { permissionSetId: permissionSet.id } }),
        tx.crmPermissionSetFieldPermission.deleteMany({ where: { permissionSetId: permissionSet.id } }),
        tx.crmPermissionSetAppPermission.deleteMany({ where: { permissionSetId: permissionSet.id } }),
        tx.crmPermissionSetTabPermission.deleteMany({ where: { permissionSetId: permissionSet.id } }),
        tx.crmPermissionSetAssignment.deleteMany({ where: { permissionSetId: permissionSet.id } }),
      ]);
      if (input.data.objectPermissions.length) await tx.crmPermissionSetObjectPermission.createMany({ data: input.data.objectPermissions.map((grant) => ({ ...grant, permissionSetId: permissionSet.id })) });
      if (input.data.fieldPermissions.length) await tx.crmPermissionSetFieldPermission.createMany({ data: input.data.fieldPermissions.map((grant) => ({ ...grant, permissionSetId: permissionSet.id })) });
      if (input.data.appPermissions.length) await tx.crmPermissionSetAppPermission.createMany({ data: input.data.appPermissions.map((grant) => ({ ...grant, permissionSetId: permissionSet.id })) });
      if (input.data.tabPermissions.length) await tx.crmPermissionSetTabPermission.createMany({ data: input.data.tabPermissions.map((grant) => ({ ...grant, permissionSetId: permissionSet.id })) });
      if (input.data.userIds.length) await tx.crmPermissionSetAssignment.createMany({
        data: input.data.userIds.map((userId) => ({ userId, permissionSetId: permissionSet.id })),
      });
      await auditCrmChange(tx, admin.user.id, "PERMISSION_SET_UPDATED", "CrmPermissionSet", permissionSet.id, {
        name: updated.name,
        objectPermissions: input.data.objectPermissions.length,
        fieldPermissions: input.data.fieldPermissions.length,
        appPermissions: input.data.appPermissions.length,
        assignedUsers: input.data.userIds.length,
      });
      return tx.crmPermissionSet.findUniqueOrThrow({ where: { id: permissionSet.id }, include: permissionSetIncludes });
    });
    return NextResponse.json(saved);
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "A permission set with that name already exists." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = z.object({ permissionSetId: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const permissionSet = await prisma.crmPermissionSet.findUnique({
    where: { id: input.data.permissionSetId },
    select: { id: true, key: true, name: true, _count: { select: { assignments: true } } },
  });
  if (!permissionSet) return NextResponse.json({ error: "The selected permission set does not exist." }, { status: 404 });
  if (permissionSet._count.assignments) return NextResponse.json({ error: "Remove all user assignments before deleting this permission set." }, { status: 409 });
  await prisma.$transaction(async (tx) => {
    await tx.crmPermissionSet.delete({ where: { id: permissionSet.id } });
    await auditCrmChange(tx, admin.user.id, "PERMISSION_SET_DELETED", "CrmPermissionSet", permissionSet.id, { key: permissionSet.key, name: permissionSet.name });
  });
  return NextResponse.json({ success: true });
}
