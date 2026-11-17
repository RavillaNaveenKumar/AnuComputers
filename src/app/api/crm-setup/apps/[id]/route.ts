import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";

const assignmentSchema = z.object({
  objectId: z.string().min(1),
  navigationOrder: z.number().int().min(0),
  label: z.string().trim().max(100).nullable().optional(),
  icon: z.string().trim().max(40).nullable().optional(),
  defaultListView: z.string().trim().max(100).nullable().optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  icon: z.string().trim().min(1).max(40),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  defaultObjectId: z.string().nullable(),
  assignments: z.array(assignmentSchema).max(200),
}).superRefine(({ assignments }, context) => {
  if (new Set(assignments.map((item) => item.objectId)).size !== assignments.length) {
    context.addIssue({ code: "custom", message: "An object can only be assigned to an application once." });
  }
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const input = updateSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const app = await prisma.crmApp.findUnique({ where: { id }, select: { id: true, key: true } });
  if (!app) return NextResponse.json({ error: "Application not found." }, { status: 404 });
  const ids = input.data.assignments.map((item) => item.objectId);
  const eligible = await prisma.crmObject.findMany({ where: { id: { in: ids }, active: true, objectType: { in: ["STANDARD", "CUSTOM"] } }, select: { id: true } });
  if (eligible.length !== ids.length) return NextResponse.json({ error: "Every application item must be an eligible, active CRM Setup object." }, { status: 400 });
  if (input.data.defaultObjectId && !ids.includes(input.data.defaultObjectId)) {
    return NextResponse.json({ error: "The default landing object must be included in this application." }, { status: 400 });
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (input.data.isDefault) await tx.crmApp.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    await tx.crmAppAssignment.deleteMany({ where: { appId: id, objectId: { notIn: ids } } });
    for (const assignment of input.data.assignments) {
      await tx.crmAppAssignment.upsert({
        where: { appId_objectId: { appId: id, objectId: assignment.objectId } },
        create: { ...assignment, appId: id, label: assignment.label ?? null, icon: assignment.icon ?? null, defaultListView: assignment.defaultListView ?? null },
        update: { ...assignment, label: assignment.label ?? null, icon: assignment.icon ?? null, defaultListView: assignment.defaultListView ?? null, active: true },
      });
    }
    const saved = await tx.crmApp.update({
      where: { id },
      data: { name: input.data.name, icon: input.data.icon, active: input.data.active, isDefault: input.data.isDefault, defaultObjectId: input.data.defaultObjectId },
    });
    await auditCrmChange(tx, auth.user.id, "APP_UPDATED", "CrmApp", id, { key: app.key, objectIds: ids });
    return saved;
  });
  return NextResponse.json(updated);
}
