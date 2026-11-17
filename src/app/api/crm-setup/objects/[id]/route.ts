import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  pluralLabel: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  module: z.enum(["SALES", "SERVICE", "COMMON"]).optional(),
  icon: z.string().trim().min(1).max(40).optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one object property to update.");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const input = updateSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const existing = await prisma.crmObject.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Object not found." }, { status: 404 });
  if (existing.objectType !== "CUSTOM" && Object.keys(input.data).some((key) => key !== "active")) {
    return NextResponse.json({ error: "Only custom object details can be edited. Standard objects may be activated or deactivated." }, { status: 403 });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const object = await tx.crmObject.update({ where: { id }, data: input.data });
    if (input.data.active === false && existing.active) {
      await tx.crmAppAssignment.deleteMany({ where: { objectId: id } });
      await tx.crmApp.updateMany({ where: { defaultObjectId: id }, data: { defaultObjectId: null } });
    }
    await auditCrmChange(tx, auth.user.id, input.data.active === false ? "OBJECT_DEACTIVATED" : input.data.active === true ? "OBJECT_ACTIVATED" : "OBJECT_UPDATED", "CrmObject", id, input.data);
    return object;
  });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const existing = await prisma.crmObject.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Object not found." }, { status: 404 });
  if (existing.protected || existing.objectType !== "CUSTOM") {
    return NextResponse.json({ error: "Standard and protected objects cannot be permanently deleted." }, { status: 403 });
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.crmObject.delete({ where: { id } });
      await auditCrmChange(tx, auth.user.id, "OBJECT_DELETED", "CrmObject", id, { apiName: existing.apiName });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2003") {
      return NextResponse.json({ error: "This object is referenced by other metadata and cannot be deleted. Deactivate it instead." }, { status: 409 });
    }
    throw error;
  }
}
