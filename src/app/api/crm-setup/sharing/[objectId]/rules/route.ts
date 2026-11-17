import { NextResponse } from "next/server";
import { z } from "zod";
import { auditCrmChange, isPrismaUniqueError, requireCrmAdmin } from "@/lib/crm-setup-api";
import { prisma } from "@/lib/prisma";

const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const conditionSchema = z.object({
  field: z.string().min(1).max(64),
  operator: z.enum(["EQUALS", "NOT_EQUALS", "CONTAINS", "IN", "IS_NULL"]),
  value: z.union([scalarSchema, z.array(scalarSchema).min(1).max(50)]).optional(),
}).superRefine((condition, context) => {
  if (condition.operator === "IS_NULL" && condition.value !== undefined) {
    context.addIssue({ code: "custom", path: ["value"], message: "IS_NULL does not take a value." });
  }
  if (condition.operator === "IN" && (!Array.isArray(condition.value) || condition.value.length === 0)) {
    context.addIssue({ code: "custom", path: ["value"], message: "IN requires a non-empty list." });
  }
  if (condition.operator === "CONTAINS" && typeof condition.value !== "string") {
    context.addIssue({ code: "custom", path: ["value"], message: "CONTAINS requires a text value." });
  }
  if (["EQUALS", "NOT_EQUALS"].includes(condition.operator) && (condition.value === undefined || Array.isArray(condition.value))) {
    context.addIssue({ code: "custom", path: ["value"], message: "Choose one comparison value." });
  }
});
const criteriaSchema = z.object({
  operator: z.enum(["AND", "OR"]),
  conditions: z.array(conditionSchema).min(1).max(20),
});
const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  ruleType: z.enum(["OWNER", "CRITERIA"]),
  sourceHierarchyRoleId: z.string().min(1).nullable(),
  sourceIncludesSubordinates: z.boolean(),
  criteria: criteriaSchema.nullable(),
  targetUserId: z.string().min(1).nullable(),
  targetHierarchyRoleId: z.string().min(1).nullable(),
  targetIncludesSubordinates: z.boolean(),
  access: z.enum(["READ", "EDIT"]),
}).superRefine((rule, context) => {
  if (Boolean(rule.targetUserId) === Boolean(rule.targetHierarchyRoleId)) {
    context.addIssue({ code: "custom", path: ["targetUserId"], message: "Choose exactly one target user or hierarchy role." });
  }
  if (rule.ruleType === "OWNER" && (!rule.sourceHierarchyRoleId || rule.criteria !== null)) {
    context.addIssue({ code: "custom", path: ["sourceHierarchyRoleId"], message: "Owner rules require an owner hierarchy role and no criteria." });
  }
  if (rule.ruleType === "CRITERIA" && (rule.sourceHierarchyRoleId !== null || !rule.criteria)) {
    context.addIssue({ code: "custom", path: ["criteria"], message: "Criteria rules require criteria and no owner hierarchy role." });
  }
  if (rule.targetUserId && rule.targetIncludesSubordinates) {
    context.addIssue({ code: "custom", path: ["targetIncludesSubordinates"], message: "Subordinates can only be included for hierarchy-role targets." });
  }
});

export async function GET(_request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const [object, rules] = await Promise.all([
    prisma.crmObject.findUnique({ where: { id: objectId }, select: { id: true } }),
    prisma.crmSharingRule.findMany({
      where: { objectId },
      include: {
        sourceHierarchyRole: { select: { id: true, name: true } },
        targetHierarchyRole: { select: { id: true, name: true } },
        targetUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!object) return NextResponse.json({ error: "CRM object not found." }, { status: 404 });
  return NextResponse.json(rules);
}

export async function POST(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const input = ruleSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const rule = input.data;
  const object = await prisma.crmObject.findUnique({ where: { id: objectId }, select: { id: true } });
  if (!object) return NextResponse.json({ error: "CRM object not found." }, { status: 404 });

  const [sourceRole, targetRole, targetUser, fields] = await Promise.all([
    rule.sourceHierarchyRoleId
      ? prisma.crmHierarchyRole.findUnique({ where: { id: rule.sourceHierarchyRoleId }, select: { id: true } })
      : Promise.resolve(null),
    rule.targetHierarchyRoleId
      ? prisma.crmHierarchyRole.findUnique({ where: { id: rule.targetHierarchyRoleId }, select: { id: true } })
      : Promise.resolve(null),
    rule.targetUserId
      ? prisma.user.findFirst({
        where: { id: rule.targetUserId, active: true, profile: { allowLogin: true } },
        select: { id: true },
      })
      : Promise.resolve(null),
    rule.criteria
      ? prisma.crmField.findMany({
        where: { objectId, active: true, apiName: { in: rule.criteria.conditions.map(({ field }) => field) } },
        select: { apiName: true },
      })
      : Promise.resolve([]),
  ]);
  if (rule.sourceHierarchyRoleId && !sourceRole) return NextResponse.json({ error: "Owner hierarchy role not found." }, { status: 400 });
  if (rule.targetHierarchyRoleId && !targetRole) return NextResponse.json({ error: "Target hierarchy role not found." }, { status: 400 });
  if (rule.targetUserId && !targetUser) return NextResponse.json({ error: "Target user must be active and allowed to sign in." }, { status: 400 });
  if (rule.criteria && fields.length !== new Set(rule.criteria.conditions.map(({ field }) => field)).size) {
    return NextResponse.json({ error: "Criteria must reference active fields on this object." }, { status: 400 });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const saved = await tx.crmSharingRule.create({
        data: {
          objectId,
          name: rule.name,
          ruleType: rule.ruleType,
          sourceHierarchyRoleId: rule.sourceHierarchyRoleId,
          sourceIncludesSubordinates: rule.sourceIncludesSubordinates,
          criteria: rule.criteria ?? undefined,
          targetUserId: rule.targetUserId,
          targetHierarchyRoleId: rule.targetHierarchyRoleId,
          targetIncludesSubordinates: rule.targetIncludesSubordinates,
          access: rule.access,
        },
        include: {
          sourceHierarchyRole: { select: { id: true, name: true } },
          targetHierarchyRole: { select: { id: true, name: true } },
          targetUser: { select: { id: true, name: true, email: true } },
        },
      });
      await auditCrmChange(tx, auth.user.id, "RECORD_SHARING_RULE_CREATED", "CrmSharingRule", saved.id, {
        objectId,
        name: saved.name,
        ruleType: saved.ruleType,
        access: saved.access,
      });
      return saved;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "A sharing rule with that name already exists on this object." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const { objectId } = await context.params;
  const input = z.object({ id: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const rule = await prisma.crmSharingRule.findFirst({ where: { id: input.data.id, objectId }, select: { id: true, name: true } });
  if (!rule) return NextResponse.json({ error: "Sharing rule not found." }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.crmSharingRule.delete({ where: { id: rule.id } });
    await auditCrmChange(tx, auth.user.id, "RECORD_SHARING_RULE_DELETED", "CrmSharingRule", rule.id, { objectId, name: rule.name });
  });
  return NextResponse.json({ deleted: true });
}
