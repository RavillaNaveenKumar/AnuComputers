import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addFieldToLayoutSections, auditCrmChange, removeFieldFromLayoutSections, requireCrmAdmin } from "@/lib/crm-setup-api";

const updateSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().max(1000).nullable().optional(),
  unique: z.boolean().optional(),
  externalId: z.boolean().optional(),
  fieldLength: z.number().int().min(1).max(100000).nullable().optional(),
  decimalPlaces: z.number().int().min(0).max(10).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  helpText: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  picklistValues: z.array(z.object({ value: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(100) })).max(200).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field property to update.");

export async function PATCH(request: Request, context: { params: Promise<{ id: string; fieldId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { id: objectId, fieldId } = await context.params;
  const input = updateSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const existing = await prisma.crmField.findFirst({ where: { id: fieldId, objectId }, include: { picklistValues: true } });
  if (!existing) return NextResponse.json({ error: "Field not found on this object." }, { status: 404 });
  if (existing.origin === "SYSTEM") return NextResponse.json({ error: "System fields cannot be modified." }, { status: 403 });
  if (existing.protected && (input.data.active === false || input.data.required === false)) {
    return NextResponse.json({ error: "Protected system fields cannot be deactivated or made optional." }, { status: 403 });
  }
  if (existing.dataType === "AUTO_NUMBER" && input.data.required === false) {
    return NextResponse.json({ error: "Auto Number fields are always required." }, { status: 400 });
  }
  const { picklistValues, ...properties } = input.data;
  if (picklistValues && !["PICKLIST", "MULTI_SELECT_PICKLIST"].includes(existing.dataType)) {
    return NextResponse.json({ error: "Only picklist fields can have picklist values." }, { status: 400 });
  }
  if (picklistValues?.length === 0) return NextResponse.json({ error: "A picklist must contain at least one value." }, { status: 400 });
  if (properties.fieldLength !== undefined && properties.fieldLength !== null && existing.dataType !== "TEXT") {
    return NextResponse.json({ error: "Field length is only valid for Text fields." }, { status: 400 });
  }
  if (properties.decimalPlaces !== undefined && properties.decimalPlaces !== null && !["NUMBER", "CURRENCY", "PERCENT"].includes(existing.dataType)) {
    return NextResponse.json({ error: "Decimal places are only valid for Number, Currency, and Percent fields." }, { status: 400 });
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (picklistValues) {
      await tx.crmPicklistValue.deleteMany({ where: { fieldId } });
      await tx.crmPicklistValue.createMany({ data: picklistValues.map((value, position) => ({ ...value, position, fieldId })) });
    }
    const field = await tx.crmField.update({ where: { id: fieldId }, data: properties });
    if (properties.active === false || properties.active === true) {
      const layout = await tx.crmPageLayout.findUnique({ where: { objectId } });
      if (layout) {
        const fieldOrder = properties.active
          ? layout.fieldOrder.includes(fieldId) ? layout.fieldOrder : [...layout.fieldOrder, fieldId]
          : layout.fieldOrder.filter((id) => id !== fieldId);
        const hiddenFieldIds = properties.active
          ? layout.hiddenFieldIds.filter((id) => id !== fieldId)
          : [...new Set([...layout.hiddenFieldIds, fieldId])];
        const sections = properties.active
          ? addFieldToLayoutSections(layout.sections, fieldId)
          : removeFieldFromLayoutSections(layout.sections, fieldId);
        await tx.crmPageLayout.update({
          where: { objectId },
          data: {
            fieldOrder,
            hiddenFieldIds,
            sections,
          },
        });
      }
    }
    await auditCrmChange(tx, auth.user.id, "FIELD_UPDATED", "CrmField", fieldId, properties);
    return field;
  });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; fieldId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { id: objectId, fieldId } = await context.params;
  const field = await prisma.crmField.findFirst({ where: { id: fieldId, objectId } });
  if (!field) return NextResponse.json({ error: "Field not found on this object." }, { status: 404 });
  if (field.protected) return NextResponse.json({ error: "Protected system fields cannot be deleted." }, { status: 403 });
  await prisma.$transaction(async (tx) => {
    await tx.crmField.delete({ where: { id: fieldId } });
    const layout = await tx.crmPageLayout.findUnique({ where: { objectId } });
    if (layout) await tx.crmPageLayout.update({
      where: { objectId },
      data: {
        fieldOrder: layout.fieldOrder.filter((id) => id !== fieldId),
        hiddenFieldIds: layout.hiddenFieldIds.filter((id) => id !== fieldId),
        sections: removeFieldFromLayoutSections(layout.sections, fieldId),
      },
    });
    await auditCrmChange(tx, auth.user.id, "FIELD_DELETED", "CrmField", fieldId, { apiName: field.apiName });
  });
  return NextResponse.json({ success: true });
}
