import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addFieldToLayoutSections, auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";

const relationshipSchema = z.object({
  sourceObjectId: z.string().min(1),
  targetObjectId: z.string().min(1),
  fieldId: z.string().optional(),
  label: z.string().trim().min(1).max(100),
  relationshipType: z.enum(["LOOKUP", "ONE_TO_MANY", "MANY_TO_MANY"]),
  junctionObjectId: z.string().optional(),
});

async function ensureLookupField(
  tx: Prisma.TransactionClient,
  relationship: { id: string; sourceObjectId: string; label: string },
  actorId: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${relationship.sourceObjectId}, 1))`;
  const current = await tx.crmRelationship.findUnique({ where: { id: relationship.id }, select: { fieldId: true } });
  if (current?.fieldId) return current.fieldId;
  const [source, profiles] = await Promise.all([
    tx.crmObject.findUnique({ where: { id: relationship.sourceObjectId }, select: { id: true, fields: { select: { id: true, apiName: true, label: true, dataType: true } }, _count: { select: { fields: true } } } }),
    tx.crmProfile.findMany({ select: { id: true } }),
  ]);
  if (!source) throw new Error("The lookup source object no longer exists.");
  const usedApiNames = new Set(source.fields.map(({ apiName }) => apiName));
  const baseName = relationship.label.match(/[A-Za-z0-9]+/g)?.join("") || "RelatedRecord";
  const namePrefix = baseName.slice(0, 58);
  let apiName = `${namePrefix}Id`;
  let suffix = 2;
  while (usedApiNames.has(apiName)) {
    const suffixText = `_${suffix++}`;
    apiName = `${namePrefix.slice(0, 64 - suffixText.length - 2)}Id${suffixText}`;
  }
  const existingField = source.fields.find((field) => field.dataType === "LOOKUP" &&
    (field.apiName === `${namePrefix}Id` || field.label.trim().toLocaleLowerCase() === relationship.label.trim().toLocaleLowerCase()));
  const field = existingField ?? await tx.crmField.create({
    data: {
      objectId: source.id,
      label: relationship.label,
      apiName,
      dataType: "LOOKUP",
      origin: "CUSTOM",
      position: source._count.fields,
      helpText: `Related ${relationship.label} record.`,
    },
  });
  await tx.crmRelationship.update({ where: { id: relationship.id }, data: { fieldId: field.id } });
  if (profiles.length) await tx.crmProfileFieldPermission.createMany({
    data: profiles.map((profile) => ({ profileId: profile.id, fieldId: field.id, visible: true, editable: true })),
    skipDuplicates: true,
  });
  const layouts = await tx.crmPageLayout.findMany({ where: { objectId: source.id }, select: { id: true, fieldOrder: true, sections: true } });
  for (const layout of layouts) await tx.crmPageLayout.update({
    where: { id: layout.id },
    data: {
      fieldOrder: layout.fieldOrder.includes(field.id) ? layout.fieldOrder : [...layout.fieldOrder, field.id],
      sections: addFieldToLayoutSections(layout.sections, field.id),
    },
  });
  if (!existingField) await auditCrmChange(tx, actorId, "LOOKUP_FIELD_CREATED", "CrmField", field.id, {
    sourceObjectId: source.id, relationshipId: relationship.id, apiName,
  });
  return field.id;
}

export async function GET() {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const orphanedLookups = await prisma.crmRelationship.findMany({
    where: { relationshipType: "LOOKUP", fieldId: null },
    select: { id: true, sourceObjectId: true, label: true },
  });
  for (const relationship of orphanedLookups) {
    await prisma.$transaction((tx) => ensureLookupField(tx, relationship, auth.user.id));
  }
  const relationships = await prisma.crmRelationship.findMany({
    include: {
      sourceObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
      targetObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
      junctionObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
      field: { select: { id: true, label: true, apiName: true, dataType: true } },
    },
    orderBy: [{ sourceObject: { name: "asc" } }, { label: "asc" }],
  });
  return NextResponse.json(relationships);
}

export async function POST(request: Request) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const input = relationshipSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const data = input.data;
  if (data.sourceObjectId === data.targetObjectId) return NextResponse.json({ error: "An object cannot relate to itself." }, { status: 400 });
  if (data.relationshipType === "MANY_TO_MANY" && !data.junctionObjectId) {
    return NextResponse.json({ error: "Many-to-many relationships require a junction object." }, { status: 400 });
  }
  if (data.relationshipType !== "MANY_TO_MANY" && data.junctionObjectId) {
    return NextResponse.json({ error: "A junction object is only valid for many-to-many relationships." }, { status: 400 });
  }
  const [source, target, junction, field] = await Promise.all([
    prisma.crmObject.findUnique({ where: { id: data.sourceObjectId }, select: { id: true, active: true } }),
    prisma.crmObject.findUnique({ where: { id: data.targetObjectId }, select: { id: true, active: true } }),
    data.junctionObjectId ? prisma.crmObject.findUnique({ where: { id: data.junctionObjectId }, select: { id: true, active: true } }) : Promise.resolve(null),
    data.fieldId ? prisma.crmField.findUnique({ where: { id: data.fieldId }, select: { id: true, objectId: true, dataType: true } }) : Promise.resolve(null),
  ]);
  if (!source?.active || !target?.active) return NextResponse.json({ error: "Select active source and target objects." }, { status: 400 });
  if (data.junctionObjectId && (!junction?.active || junction.id === source.id || junction.id === target.id)) {
    return NextResponse.json({ error: "Select a separate active junction object." }, { status: 400 });
  }
  if (data.fieldId && (!field || field.objectId !== source.id || field.dataType !== "LOOKUP")) {
    return NextResponse.json({ error: "The selected relationship field must be a lookup field on the source object." }, { status: 400 });
  }
  if (data.fieldId && await prisma.crmRelationship.findUnique({ where: { fieldId: data.fieldId } })) {
    return NextResponse.json({ error: "This lookup field already has a relationship." }, { status: 409 });
  }
  const relationship = await prisma.$transaction(async (tx) => {
    const created = await tx.crmRelationship.create({
      data: {
        sourceObjectId: source.id,
        targetObjectId: target.id,
        label: data.label,
        relationshipType: data.relationshipType,
        fieldId: data.fieldId ?? null,
        junctionObjectId: junction?.id ?? null,
      },
      include: {
        sourceObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
        targetObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
        junctionObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
        field: { select: { id: true, label: true, apiName: true, dataType: true } },
      },
    });
    if (created.relationshipType === "LOOKUP" && !created.fieldId) {
      await ensureLookupField(tx, created, auth.user.id);
    }
    const linked = await tx.crmRelationship.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        sourceObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
        targetObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
        junctionObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
        field: { select: { id: true, label: true, apiName: true, dataType: true } },
      },
    });
    await auditCrmChange(tx, auth.user.id, "RELATIONSHIP_CREATED", "CrmRelationship", created.id, { sourceObjectId: source.id, targetObjectId: target.id, relationshipType: data.relationshipType });
    return linked;
  });
  return NextResponse.json(relationship, { status: 201 });
}
