import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, isPrismaUniqueError, requireCrmAdmin } from "@/lib/crm-setup-api";
import { crmSystemFields, hasStandardRecordStore, standardRecordCount, syncStandardCrmFields } from "@/lib/crm-registry";

const moduleSchema = z.enum(["SALES", "SERVICE", "COMMON"]);
const objectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pluralLabel: z.string().trim().min(1).max(100),
  apiName: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,63}$/),
  description: z.string().trim().max(1000).nullable().optional(),
  module: moduleSchema,
  icon: z.string().trim().min(1).max(40).default("Database"),
  nameFieldType: z.enum(["TEXT", "AUTO_NUMBER"]).default("TEXT"),
  nameUnique: z.boolean().default(false),
  autoNumberPrefix: z.string().trim().max(40).default(""),
  autoNumberSuffix: z.string().trim().max(40).default(""),
  autoNumberStart: z.number().int().min(0).max(2147483646).default(1),
  autoNumberDigits: z.number().int().min(1).max(12).default(4),
}).superRefine((value, context) => {
  if (value.nameFieldType === "TEXT" && (
    value.autoNumberPrefix || value.autoNumberSuffix || value.autoNumberStart !== 1 || value.autoNumberDigits !== 4
  )) context.addIssue({ code: "custom", path: ["nameFieldType"], message: "Auto Number settings are only valid for an Auto Number Name field." });
});

export async function GET(request: Request) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim();
  const moduleFilter = moduleSchema.safeParse(url.searchParams.get("module"));
  const objectType = z.enum(["STANDARD", "CUSTOM", "SYSTEM"]).safeParse(url.searchParams.get("type"));
  if (url.searchParams.has("module") && !moduleFilter.success) {
    return NextResponse.json({ error: "Choose a valid CRM module filter." }, { status: 400 });
  }
  if (url.searchParams.has("type") && !objectType.success) {
    return NextResponse.json({ error: "Choose a valid object type filter." }, { status: 400 });
  }
  const where = {
    ...(search ? { OR: [
      { name: { contains: search, mode: "insensitive" as const } },
      { pluralLabel: { contains: search, mode: "insensitive" as const } },
      { apiName: { contains: search, mode: "insensitive" as const } },
    ] } : {}),
    ...(url.searchParams.has("module") && moduleFilter.success ? { module: moduleFilter.data } : {}),
    ...(url.searchParams.has("type") && objectType.success ? { objectType: objectType.data } : {}),
  };
  await syncStandardCrmFields(prisma);
  const objects = await prisma.crmObject.findMany({
    where,
    include: {
      fields: { orderBy: { position: "asc" }, include: { picklistValues: { where: { active: true }, orderBy: { position: "asc" } }, relationship: true } },
      outgoingRelationships: { include: { targetObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } } } },
      appAssignments: { include: { app: { select: { id: true, key: true, name: true } } } },
      _count: { select: { fields: true } },
    },
    orderBy: [{ module: "asc" }, { name: "asc" }],
  });
  const enriched = await Promise.all(objects.map(async (object) => {
    const count = object.objectType === "CUSTOM" || (object.objectType === "STANDARD" && !hasStandardRecordStore(object.apiName))
      ? await prisma.crmRecord.count({ where: { objectId: object.id } })
      : await standardRecordCount(prisma, object.apiName);
    return { ...object, recordCount: count };
  }));
  return NextResponse.json(enriched);
}

export async function POST(request: Request) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const input = objectSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const apiName = input.data.apiName.endsWith("__c") ? input.data.apiName : `${input.data.apiName}__c`;
  try {
    const object = await prisma.$transaction(async (tx) => {
      const created = await tx.crmObject.create({
        data: {
          name: input.data.name,
          pluralLabel: input.data.pluralLabel,
          apiName,
          description: input.data.description || null,
          module: input.data.module,
          icon: input.data.icon,
          objectType: "CUSTOM",
          protected: false,
          displayFieldApiName: "Name",
          fields: {
            create: [
              {
                label: "Name",
                apiName: "Name",
                dataType: input.data.nameFieldType,
                required: true,
                unique: input.data.nameFieldType === "AUTO_NUMBER" || input.data.nameUnique,
                protected: true,
                origin: "STANDARD",
                readOnly: input.data.nameFieldType === "AUTO_NUMBER",
                isNameField: true,
                fieldLength: input.data.nameFieldType === "TEXT" ? 80 : null,
                autoNumberPrefix: input.data.nameFieldType === "AUTO_NUMBER" ? input.data.autoNumberPrefix : null,
                autoNumberSuffix: input.data.nameFieldType === "AUTO_NUMBER" ? input.data.autoNumberSuffix : null,
                autoNumberStart: input.data.nameFieldType === "AUTO_NUMBER" ? input.data.autoNumberStart : null,
                autoNumberDigits: input.data.nameFieldType === "AUTO_NUMBER" ? input.data.autoNumberDigits : null,
                position: 0,
              },
              ...crmSystemFields.map((field, index) => ({
                label: field.label,
                apiName: field.apiName,
                dataType: field.dataType,
                required: Boolean(field.required),
                protected: true,
                origin: "SYSTEM" as const,
                readOnly: true,
                lookupTargetApiName: field.lookupTargetApiName ?? null,
                position: index + 1,
              })),
            ],
          },
        },
        include: { fields: { orderBy: { position: "asc" } } },
      });
      const profiles = await tx.crmProfile.findMany({ select: { id: true } });
      await tx.crmProfileFieldPermission.createMany({
        data: profiles.flatMap((profile) => created.fields.map((field) => ({
          profileId: profile.id,
          fieldId: field.id,
          visible: true,
          editable: !field.readOnly && field.dataType !== "AUTO_NUMBER",
        }))),
      });
      await tx.crmPageLayout.create({ data: { objectId: created.id, fieldOrder: created.fields.map(({ id }) => id) } });
      await tx.crmSharingConfig.create({ data: { objectId: created.id } });
      await auditCrmChange(tx, auth.user.id, "OBJECT_CREATED", "CrmObject", created.id, {
        apiName,
        nameFieldType: input.data.nameFieldType,
        ...(input.data.nameFieldType === "AUTO_NUMBER" ? {
          autoNumberPrefix: input.data.autoNumberPrefix,
          autoNumberSuffix: input.data.autoNumberSuffix,
          autoNumberStart: input.data.autoNumberStart,
          autoNumberDigits: input.data.autoNumberDigits,
        } : {}),
      });
      return created;
    });
    return NextResponse.json({ ...object, recordCount: 0 }, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "An object with that API name already exists." }, { status: 409 });
    throw error;
  }
}
