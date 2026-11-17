import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, isPrismaUniqueError, requireCrmAdmin } from "@/lib/crm-setup-api";

const sectionSchema = z.object({
  id: z.string().min(1).max(80), label: z.string().trim().min(1).max(100),
  fieldIds: z.array(z.string().min(1)).max(200).optional(),
  columns: z.array(z.object({ id: z.string().min(1).max(80), fieldIds: z.array(z.string().min(1)).max(200) })).min(1).max(3).optional(),
}).refine((section) => section.fieldIds !== undefined || section.columns !== undefined, "A section must contain fields or columns.");
const tabSchema = z.object({ id: z.string().min(1).max(80), label: z.string().trim().min(1).max(100) });
const layoutSchema = z.object({
  layoutId: z.string().optional(), revision: z.number().int().optional(),
  name: z.string().trim().min(1).max(100), fieldOrder: z.array(z.string().min(1)).max(200),
  hiddenFieldIds: z.array(z.string().min(1)).max(200), requiredFieldIds: z.array(z.string().min(1)).max(200).default([]),
  readOnlyFieldIds: z.array(z.string().min(1)).max(200).default([]), sections: z.array(sectionSchema).max(50),
  relatedLists: z.array(z.string().min(1)).max(200), detailTabs: z.array(tabSchema).max(20),
}).superRefine((layout, context) => {
  for (const [label, values] of [["fieldOrder", layout.fieldOrder], ["hiddenFieldIds", layout.hiddenFieldIds], ["requiredFieldIds", layout.requiredFieldIds], ["readOnlyFieldIds", layout.readOnlyFieldIds], ["relatedLists", layout.relatedLists]] as const) {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: `${label} cannot contain duplicates.` });
  }
});

export async function GET(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const selectedId = new URL(request.url).searchParams.get("layoutId");
  const [layout, layouts] = await Promise.all([
    prisma.crmPageLayout.findFirst({
      where: { objectId, ...(selectedId ? { id: selectedId } : { isDefault: true }) },
      include: { object: { include: { fields: { where: { active: true }, orderBy: { position: "asc" } }, outgoingRelationships: true } } },
    }),
    prisma.crmPageLayout.findMany({ where: { objectId }, select: { id: true, name: true, isDefault: true, revision: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  if (!layout) return NextResponse.json({ error: "Record layout not found." }, { status: 404 });
  return NextResponse.json({ ...layout, layouts });
}

export async function PUT(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const input = layoutSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const { layoutId, revision, ...data } = input.data;
  if (!layoutId || revision === undefined) return NextResponse.json({ error: "Reload this layout before saving; its revision is missing." }, { status: 409 });
  const object = await prisma.crmObject.findUnique({
    where: { id: objectId },
    include: { fields: { where: { active: true }, select: { id: true, required: true, protected: true } }, outgoingRelationships: { select: { id: true } } },
  });
  if (!object) return NextResponse.json({ error: "Object not found." }, { status: 404 });
  const current = await prisma.crmPageLayout.findFirst({ where: { id: layoutId, objectId } });
  if (!current) return NextResponse.json({ error: "The selected layout does not belong to this object." }, { status: 400 });
  if (current.revision !== revision) return NextResponse.json({ error: "This layout changed elsewhere. Reload it before saving." }, { status: 409 });
  const fieldIds = new Set(object.fields.map((field) => field.id));
  if (data.fieldOrder.some((id) => !fieldIds.has(id)) || data.hiddenFieldIds.some((id) => !fieldIds.has(id))) return NextResponse.json({ error: "Layouts can only use fields belonging to their object." }, { status: 400 });
  if (data.hiddenFieldIds.some((id) => { const field = object.fields.find((item) => item.id === id); return field?.required || field?.protected; })) return NextResponse.json({ error: "Required and protected fields cannot be hidden." }, { status: 400 });
  if (data.hiddenFieldIds.some((id) => data.fieldOrder.includes(id))) return NextResponse.json({ error: "A field cannot be both visible and hidden." }, { status: 400 });
  if ([...data.requiredFieldIds, ...data.readOnlyFieldIds].some((id) => !fieldIds.has(id))) return NextResponse.json({ error: "Layout behavior can only reference fields belonging to this object." }, { status: 400 });
  if (data.requiredFieldIds.some((id) => data.hiddenFieldIds.includes(id))) return NextResponse.json({ error: "A required field must be visible on the layout." }, { status: 400 });
  if (object.fields.some((field) => (field.required || field.protected) && !data.fieldOrder.includes(field.id))) return NextResponse.json({ error: "Required and protected fields must remain in the record layout." }, { status: 400 });
  const sectionFieldIds = data.sections.flatMap((section) => section.columns?.flatMap((column) => column.fieldIds) || section.fieldIds || []);
  if (sectionFieldIds.some((id) => !fieldIds.has(id))) return NextResponse.json({ error: "Layout sections can only reference fields belonging to their object." }, { status: 400 });
  if (new Set(sectionFieldIds).size !== sectionFieldIds.length) return NextResponse.json({ error: "A field can only appear once across the layout sections." }, { status: 400 });
  const relationshipIds = new Set(object.outgoingRelationships.map(({ id }) => id));
  if (data.relatedLists.some((id) => !relationshipIds.has(id))) return NextResponse.json({ error: "Related lists must reference relationships belonging to this object." }, { status: 400 });
  const saved = await prisma.$transaction(async (tx) => {
    const result = await tx.crmPageLayout.updateMany({ where: { id: layoutId, objectId, revision }, data: { ...data, revision: { increment: 1 } } });
    if (!result.count) return null;
    const row = await tx.crmPageLayout.findUniqueOrThrow({ where: { id: layoutId } });
    await auditCrmChange(tx, auth.user.id, "PAGE_LAYOUT_UPDATED", "CrmPageLayout", row.id, { objectId, name: row.name });
    return row;
  });
  if (!saved) return NextResponse.json({ error: "This layout changed elsewhere. Reload it before saving." }, { status: 409 });
  return NextResponse.json(saved);
}

export async function POST(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const input = z.object({ name: z.string().trim().min(1).max(100), sourceLayoutId: z.string().min(1).optional() }).safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const source = input.data.sourceLayoutId
    ? await prisma.crmPageLayout.findFirst({ where: { id: input.data.sourceLayoutId, objectId } })
    : await prisma.crmPageLayout.findFirst({ where: { objectId, isDefault: true } });
  if (!source) return NextResponse.json({ error: "Choose a source layout belonging to this object." }, { status: 400 });
  try {
    const layout = await prisma.$transaction(async (tx) => {
      const created = await tx.crmPageLayout.create({ data: {
        objectId, name: input.data.name, fieldOrder: source.fieldOrder, hiddenFieldIds: source.hiddenFieldIds,
        requiredFieldIds: source.requiredFieldIds, readOnlyFieldIds: source.readOnlyFieldIds,
        sections: source.sections ?? [], relatedLists: source.relatedLists, detailTabs: source.detailTabs ?? [],
      } });
      await auditCrmChange(tx, auth.user.id, "PAGE_LAYOUT_CREATED", "CrmPageLayout", created.id, { objectId, name: created.name, sourceLayoutId: source.id });
      return created;
    });
    return NextResponse.json(layout, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "A layout with that name already exists for this object." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const layoutId = new URL(request.url).searchParams.get("layoutId");
  if (!layoutId) return NextResponse.json({ error: "Choose a layout to delete." }, { status: 400 });
  const layout = await prisma.crmPageLayout.findFirst({ where: { id: layoutId, objectId }, include: { _count: { select: { assignments: true } } } });
  if (!layout) return NextResponse.json({ error: "Layout not found for this object." }, { status: 404 });
  if (layout.isDefault) return NextResponse.json({ error: "The default layout cannot be deleted." }, { status: 409 });
  if (layout._count.assignments) return NextResponse.json({ error: "Reassign profiles before deleting this layout." }, { status: 409 });
  await prisma.$transaction(async (tx) => {
    await tx.crmPageLayout.delete({ where: { id: layout.id } });
    await auditCrmChange(tx, auth.user.id, "PAGE_LAYOUT_DELETED", "CrmPageLayout", layout.id, { objectId, name: layout.name });
  });
  return NextResponse.json({ success: true });
}
