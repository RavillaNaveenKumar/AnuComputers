import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";

const relationshipSchema = z.object({
  sourceObjectId: z.string().min(1),
  targetObjectId: z.string().min(1),
  fieldId: z.string().optional(),
  label: z.string().trim().min(1).max(100),
  relationshipType: z.enum(["LOOKUP", "ONE_TO_MANY", "MANY_TO_MANY"]),
  junctionObjectId: z.string().optional(),
});

export async function GET() {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
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
    await auditCrmChange(tx, auth.user.id, "RELATIONSHIP_CREATED", "CrmRelationship", created.id, { sourceObjectId: source.id, targetObjectId: target.id, relationshipType: data.relationshipType });
    return created;
  });
  return NextResponse.json(relationship, { status: 201 });
}
