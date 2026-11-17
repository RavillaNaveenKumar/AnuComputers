import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, isPrismaUniqueError, requireCrmAdmin } from "@/lib/crm-setup-api";
import { hasStandardRecordStore, standardRecordCount } from "@/lib/crm-registry";

const fieldType = z.enum(["TEXT", "TEXT_AREA", "LONG_TEXT_AREA", "NUMBER", "CURRENCY", "PERCENT", "DATE", "DATETIME", "EMAIL", "PHONE", "URL", "CHECKBOX", "PICKLIST", "MULTI_SELECT_PICKLIST", "LOOKUP", "AUTO_NUMBER"]);
const relationshipType = z.enum(["LOOKUP", "ONE_TO_MANY", "MANY_TO_MANY"]);
const fieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  apiName: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,63}$/),
  dataType: fieldType,
  required: z.boolean().default(false),
  defaultValue: z.string().max(1000).nullable().optional(),
  unique: z.boolean().default(false),
  externalId: z.boolean().default(false),
  fieldLength: z.number().int().min(1).max(100000).nullable().optional(),
  decimalPlaces: z.number().int().min(0).max(10).nullable().optional(),
  autoNumberPrefix: z.string().trim().max(40).default(""),
  autoNumberSuffix: z.string().trim().max(40).default(""),
  autoNumberStart: z.number().int().min(0).max(2147483646).default(1),
  autoNumberDigits: z.number().int().min(1).max(12).default(4),
  description: z.string().trim().max(1000).nullable().optional(),
  helpText: z.string().trim().max(500).nullable().optional(),
  picklistValues: z.array(z.object({ value: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(100) })).max(200).default([]),
  relatedObjectId: z.string().optional(),
  relationshipType: relationshipType.default("LOOKUP"),
  junctionObjectId: z.string().optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const object = await prisma.crmObject.findUnique({ where: { id }, select: { id: true } });
  if (!object) return NextResponse.json({ error: "Object not found." }, { status: 404 });
  const fields = await prisma.crmField.findMany({
    where: { objectId: id },
    include: { picklistValues: { orderBy: { position: "asc" } }, relationship: { include: { targetObject: { select: { id: true, name: true, pluralLabel: true } } } } },
    orderBy: { position: "asc" },
  });
  return NextResponse.json(fields);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { id: objectId } = await context.params;
  const input = fieldSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const object = await prisma.crmObject.findUnique({ where: { id: objectId } });
  if (!object) return NextResponse.json({ error: "Object not found." }, { status: 404 });
  if (!object.active) return NextResponse.json({ error: "Fields cannot be added to an inactive object." }, { status: 409 });
  const data = input.data;
  const defaultValue = data.defaultValue?.trim() || null;
  const isPicklist = data.dataType === "PICKLIST" || data.dataType === "MULTI_SELECT_PICKLIST";
  const isNumeric = ["NUMBER", "CURRENCY", "PERCENT"].includes(data.dataType);
  if (isPicklist && data.picklistValues.length === 0) return NextResponse.json({ error: "Add at least one value for a picklist field." }, { status: 400 });
  if (new Set(data.picklistValues.map(({ value }) => value)).size !== data.picklistValues.length) return NextResponse.json({ error: "Picklist values must be unique." }, { status: 400 });
  if (!isPicklist && data.picklistValues.length > 0) return NextResponse.json({ error: "Picklist values are only valid for picklist fields." }, { status: 400 });
  if (data.fieldLength !== undefined && data.fieldLength !== null && data.dataType !== "TEXT") return NextResponse.json({ error: "Field length is only valid for Text fields." }, { status: 400 });
  if (data.decimalPlaces !== undefined && data.decimalPlaces !== null && !isNumeric) return NextResponse.json({ error: "Decimal places are only valid for Number, Currency, and Percent fields." }, { status: 400 });
  if (data.dataType !== "AUTO_NUMBER" && (
    data.autoNumberPrefix || data.autoNumberSuffix || data.autoNumberStart !== 1 || data.autoNumberDigits !== 4
  )) return NextResponse.json({ error: "Auto Number settings are only valid for Auto Number fields." }, { status: 400 });
  if (data.dataType === "AUTO_NUMBER" && defaultValue !== null) return NextResponse.json({ error: "Auto Number fields cannot have a default value." }, { status: 400 });
  if (defaultValue !== null) {
    if (data.dataType === "TEXT" && defaultValue.length > (data.fieldLength ?? 80)) {
      return NextResponse.json({ error: "Default value exceeds the configured field length." }, { status: 400 });
    }
    if (isNumeric && (!Number.isFinite(Number(defaultValue)) ||
      (data.decimalPlaces !== undefined && data.decimalPlaces !== null && Number(Number(defaultValue).toFixed(data.decimalPlaces)) !== Number(defaultValue)))) {
      return NextResponse.json({ error: "Default value must match the field's numeric precision." }, { status: 400 });
    }
    if (data.dataType === "CHECKBOX" && !["true", "false"].includes(defaultValue.toLowerCase())) {
      return NextResponse.json({ error: "Checkbox defaults must be true or false." }, { status: 400 });
    }
    if (data.dataType === "PICKLIST" && !data.picklistValues.some(({ value }) => value === defaultValue)) {
      return NextResponse.json({ error: "Picklist default must match one of its values." }, { status: 400 });
    }
    if (data.dataType === "MULTI_SELECT_PICKLIST") {
      let choices: unknown;
      try {
        choices = JSON.parse(defaultValue);
      } catch {
        choices = defaultValue.split(",").map((value) => value.trim()).filter(Boolean);
      }
      if (!Array.isArray(choices) || choices.some((value) => typeof value !== "string" || !data.picklistValues.some((option) => option.value === value))) {
        return NextResponse.json({ error: "Multi-select default must contain only configured picklist values." }, { status: 400 });
      }
    }
    if (data.dataType === "DATE" && Number.isNaN(Date.parse(defaultValue))) {
      return NextResponse.json({ error: "Date default must be a valid date." }, { status: 400 });
    }
    if (data.dataType === "DATETIME" && Number.isNaN(Date.parse(defaultValue))) {
      return NextResponse.json({ error: "DateTime default must be a valid timestamp." }, { status: 400 });
    }
  }
  if (data.dataType === "LOOKUP" && !data.relatedObjectId) return NextResponse.json({ error: "Select a related object for lookup fields." }, { status: 400 });
  if (data.dataType !== "LOOKUP" && (data.relatedObjectId || data.junctionObjectId)) return NextResponse.json({ error: "Related objects are only valid for lookup fields." }, { status: 400 });
  if (data.dataType === "LOOKUP" && data.relatedObjectId === objectId) return NextResponse.json({ error: "An object cannot relate to itself." }, { status: 400 });
  const target = data.relatedObjectId ? await prisma.crmObject.findUnique({ where: { id: data.relatedObjectId }, select: { id: true, active: true } }) : null;
  if (data.relatedObjectId && (!target || !target.active)) return NextResponse.json({ error: "Choose an active related object." }, { status: 400 });
  const junction = data.junctionObjectId ? await prisma.crmObject.findUnique({ where: { id: data.junctionObjectId }, select: { id: true, active: true } }) : null;
  if (data.relationshipType === "MANY_TO_MANY" && data.dataType === "LOOKUP" && (!junction || !junction.active)) {
    return NextResponse.json({ error: "Many-to-many relationships require an active junction object." }, { status: 400 });
  }
  if (data.relationshipType !== "MANY_TO_MANY" && data.junctionObjectId) return NextResponse.json({ error: "A junction object is only used for many-to-many relationships." }, { status: 400 });
  if (data.dataType === "AUTO_NUMBER") {
    const recordCount = object.objectType === "STANDARD" && hasStandardRecordStore(object.apiName)
      ? await standardRecordCount(prisma, object.apiName)
      : await prisma.crmRecord.count({ where: { objectId } });
    if (recordCount > 0) return NextResponse.json({ error: "Add Auto Number fields before creating records so existing rows do not require a generated-value backfill." }, { status: 409 });
  }
  const fieldCount = await prisma.crmField.count({ where: { objectId } });
  try {
    const field = await prisma.$transaction(async (tx) => {
      const created = await tx.crmField.create({
        data: {
          objectId,
          label: data.label,
          apiName: data.apiName,
          dataType: data.dataType,
          required: data.dataType === "AUTO_NUMBER" || data.required,
          defaultValue,
          unique: data.dataType === "AUTO_NUMBER" || data.unique,
          origin: "CUSTOM",
          readOnly: data.dataType === "AUTO_NUMBER",
          fieldLength: data.fieldLength ?? (data.dataType === "TEXT" ? 80 : null),
          decimalPlaces: data.decimalPlaces ?? null,
          externalId: data.externalId,
          autoNumberPrefix: data.dataType === "AUTO_NUMBER" ? data.autoNumberPrefix : null,
          autoNumberSuffix: data.dataType === "AUTO_NUMBER" ? data.autoNumberSuffix : null,
          autoNumberStart: data.dataType === "AUTO_NUMBER" ? data.autoNumberStart : null,
          autoNumberDigits: data.dataType === "AUTO_NUMBER" ? data.autoNumberDigits : null,
          description: data.description ?? null,
          helpText: data.helpText ?? null,
          position: fieldCount,
          protected: false,
          ...(isPicklist ? { picklistValues: { create: data.picklistValues.map((value, position) => ({ ...value, position })) } } : {}),
          ...(data.dataType === "LOOKUP" && target ? {
            relationship: { create: {
              sourceObjectId: objectId,
              targetObjectId: target.id,
              label: data.label,
              relationshipType: data.relationshipType,
              ...(junction ? { junctionObjectId: junction.id } : {}),
            } },
          } : {}),
        },
        include: { picklistValues: { orderBy: { position: "asc" } }, relationship: true },
      });
      const profiles = await tx.crmProfile.findMany({ select: { id: true } });
      if (profiles.length) await tx.crmProfileFieldPermission.createMany({
        data: profiles.map((profile) => ({
          profileId: profile.id,
          fieldId: created.id,
          visible: true,
          editable: !created.readOnly,
        })),
      });
      await tx.crmPageLayout.updateMany({
        where: { objectId },
        data: { fieldOrder: { push: created.id } },
      });
      await auditCrmChange(tx, auth.user.id, "FIELD_CREATED", "CrmField", created.id, { objectId, apiName: data.apiName, dataType: data.dataType });
      return created;
    });
    return NextResponse.json(field, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "A field with that API name already exists on this object." }, { status: 409 });
    throw error;
  }
}
