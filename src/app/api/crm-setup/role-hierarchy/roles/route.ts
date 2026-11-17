import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, isPrismaUniqueError, requireCrmAdmin } from "@/lib/crm-setup-api";
import { roleParentCreatesCycle } from "@/lib/crm-role-hierarchy";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  parentId: z.string().min(1).nullable(),
});
const updateSchema = createSchema.extend({ roleId: z.string().min(1) });
const deleteSchema = z.object({ roleId: z.string().min(1) });

async function validateParent(parentId: string | null, roleId?: string) {
  if (!parentId) return null;
  const parentByRoleId = new Map<string, string | null>();
  let currentId: string | null = parentId;
  while (currentId && !parentByRoleId.has(currentId)) {
    const ancestor: { parentId: string | null } | null = await prisma.crmHierarchyRole.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!ancestor) return NextResponse.json({ error: "The selected parent role does not exist." }, { status: 404 });
    parentByRoleId.set(currentId, ancestor.parentId);
    currentId = ancestor.parentId;
  }
  if (roleId && roleParentCreatesCycle(roleId, parentId, parentByRoleId)) {
    return NextResponse.json({ error: "A role cannot be its own parent or a descendant of itself." }, { status: 409 });
  }
  if (!roleId && roleParentCreatesCycle("", parentId, parentByRoleId)) {
    return NextResponse.json({ error: "The existing role hierarchy contains a cycle. Correct it before making this change." }, { status: 409 });
  }
  return null;
}

export async function POST(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = createSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const parentError = await validateParent(input.data.parentId);
  if (parentError) return parentError;
  const key = `custom-role-${input.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "custom"}-${randomUUID().slice(0, 8)}`;
  try {
    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.crmHierarchyRole.create({
        data: { key, name: input.data.name, description: input.data.description ?? null, parentId: input.data.parentId },
        select: { id: true, key: true, name: true, description: true, builtIn: true, parentId: true },
      });
      await auditCrmChange(tx, admin.user.id, "HIERARCHY_ROLE_CREATED", "CrmHierarchyRole", created.id, {
        name: created.name,
        parentId: created.parentId,
      });
      return created;
    });
    return NextResponse.json(role, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "A hierarchy role with that name already exists." }, { status: 409 });
    throw error;
  }
}

export async function PUT(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = updateSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const existing = await prisma.crmHierarchyRole.findUnique({
    where: { id: input.data.roleId },
    select: { id: true, name: true, parentId: true },
  });
  if (!existing) return NextResponse.json({ error: "The selected hierarchy role does not exist." }, { status: 404 });
  const parentError = await validateParent(input.data.parentId, existing.id);
  if (parentError) return parentError;
  try {
    const role = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmHierarchyRole.update({
        where: { id: existing.id },
        data: { name: input.data.name, description: input.data.description ?? null, parentId: input.data.parentId },
        select: { id: true, key: true, name: true, description: true, builtIn: true, parentId: true },
      });
      await auditCrmChange(tx, admin.user.id, "HIERARCHY_ROLE_UPDATED", "CrmHierarchyRole", updated.id, {
        name: updated.name,
        previousName: existing.name,
        parentId: updated.parentId,
        previousParentId: existing.parentId,
      });
      return updated;
    });
    return NextResponse.json(role);
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "A hierarchy role with that name already exists." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const role = await prisma.crmHierarchyRole.findUnique({
    where: { id: input.data.roleId },
    select: { id: true, key: true, name: true, builtIn: true, _count: { select: { children: true, userAssignments: true } } },
  });
  if (!role) return NextResponse.json({ error: "The selected hierarchy role does not exist." }, { status: 404 });
  if (role.builtIn) return NextResponse.json({ error: "Built-in hierarchy roles cannot be deleted." }, { status: 409 });
  if (role._count.children) return NextResponse.json({ error: "Reassign child roles before deleting this role." }, { status: 409 });
  if (role._count.userAssignments) return NextResponse.json({ error: "Reassign users before deleting this role." }, { status: 409 });
  await prisma.$transaction(async (tx) => {
    await tx.crmHierarchyRole.delete({ where: { id: role.id } });
    await auditCrmChange(tx, admin.user.id, "HIERARCHY_ROLE_DELETED", "CrmHierarchyRole", role.id, {
      key: role.key,
      name: role.name,
    });
  });
  return NextResponse.json({ success: true });
}
