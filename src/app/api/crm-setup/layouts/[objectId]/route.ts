import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";

const sectionSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().trim().min(1).max(100),
  fieldIds: z.array(z.string().min(1)).max(200),
});
const tabSchema = z.object({ id: z.string().min(1).max(80), label: z.string().trim().min(1).max(100) });
const layoutSchema = z.object({
  name: z.string().trim().min(1).max(100),
  fieldOrder: z.array(z.string().min(1)).max(200),
  hiddenFieldIds: z.array(z.string().min(1)).max(200),
  sections: z.array(sectionSchema).max(50),
  relatedLists: z.array(z.string().min(1)).max(200),
  detailTabs: z.array(tabSchema).max(20),
}).superRefine((layout, context) => {
  for (const [label, values] of [["fieldOrder", layout.fieldOrder], ["hiddenFieldIds", layout.hiddenFieldIds], ["relatedLists", layout.relatedLists]] as const) {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: `${label} cannot contain duplicates.` });
  }
});

export async function GET(_request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const layout = await prisma.crmPageLayout.findUnique({
    where: { objectId },
    include: { object: { include: { fields: { where: { active: true }, orderBy: { position: "asc" } }, outgoingRelationships: true } } },
  });
  if (!layout) return NextResponse.json({ error: "Record layout not found." }, { status: 404 });
  return NextResponse.json(layout);
}

export async function PUT(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const input = layoutSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const object = await prisma.crmObject.findUnique({
    where: { id: objectId },
    include: { fields: { where: { active: true }, select: { id: true, required: true, protected: true } }, outgoingRelationships: { select: { id: true } } },
  });
  if (!object) return NextResponse.json({ error: "Object not found." }, { status: 404 });
  const fieldIds = new Set(object.fields.map((field) => field.id));
  if (input.data.fieldOrder.some((id) => !fieldIds.has(id)) || input.data.hiddenFieldIds.some((id) => !fieldIds.has(id))) {
    return NextResponse.json({ error: "Layouts can only use fields belonging to their object." }, { status: 400 });
  }
  if (input.data.hiddenFieldIds.some((id) => {
    const field = object.fields.find((item) => item.id === id);
    return field?.required || field?.protected;
  })) return NextResponse.json({ error: "Required and protected fields cannot be hidden." }, { status: 400 });
  if (input.data.hiddenFieldIds.some((id) => input.data.fieldOrder.includes(id))) {
    return NextResponse.json({ error: "A field cannot be both visible and hidden." }, { status: 400 });
  }
  if (object.fields.some((field) => (field.required || field.protected) && !input.data.fieldOrder.includes(field.id))) {
    return NextResponse.json({ error: "Required and protected fields must remain in the record layout." }, { status: 400 });
  }
  if (input.data.sections.some((section) => section.fieldIds.some((id) => !fieldIds.has(id)))) {
    return NextResponse.json({ error: "Layout sections can only reference fields belonging to their object." }, { status: 400 });
  }
  const relationshipIds = new Set(object.outgoingRelationships.map((relationship) => relationship.id));
  if (input.data.relatedLists.some((id) => !relationshipIds.has(id))) {
    return NextResponse.json({ error: "Related lists must reference relationships belonging to this object." }, { status: 400 });
  }
  const layout = await prisma.$transaction(async (tx) => {
    const saved = await tx.crmPageLayout.upsert({
      where: { objectId },
      create: {
        objectId,
        ...input.data,
      },
      update: {
        ...input.data,
      },
    });
    await auditCrmChange(tx, auth.user.id, "PAGE_LAYOUT_UPDATED", "CrmPageLayout", saved.id, { objectId });
    return saved;
  });
  return NextResponse.json(layout);
}
