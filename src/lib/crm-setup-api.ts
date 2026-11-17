import { NextResponse } from "next/server";
import { evaluateAuthorization } from "./authorization";
import type { Prisma } from "@prisma/client";

export async function requireCrmAdmin() {
  const authorization = await evaluateAuthorization();
  if (!authorization.allowed) {
    return { response: NextResponse.json({ error: authorization.error }, { status: authorization.status }) };
  }
  const { user } = authorization;
  if (user.role !== "ADMIN") return { response: NextResponse.json({ error: "Administrator access is required." }, { status: 403 }) };
  return { user };
}

export async function auditCrmChange(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  details?: Prisma.InputJsonValue,
) {
  await tx.crmAuditLog.create({
    data: { actorId, action, resourceType, resourceId, ...(details ? { details } : {}) },
  });
}

export function removeFieldFromLayoutSections(sections: Prisma.JsonValue, fieldId: string): Prisma.InputJsonValue {
  if (!Array.isArray(sections)) return [];
  return sections.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return {};
    const section = item as Prisma.JsonObject;
    const fieldIds = section.fieldIds;
    return Array.isArray(fieldIds)
      ? { ...section, fieldIds: fieldIds.filter((id) => typeof id === "string" && id !== fieldId) }
      : section;
  }) as Prisma.InputJsonValue;
}

export function addFieldToLayoutSections(sections: Prisma.JsonValue, fieldId: string): Prisma.InputJsonValue {
  if (!Array.isArray(sections) || sections.length === 0) return sections as Prisma.InputJsonValue;
  const sectionIndex = sections.findIndex((item) => typeof item === "object" && item !== null && !Array.isArray(item));
  if (sectionIndex < 0) return sections as Prisma.InputJsonValue;
  return sections.map((item, index) => {
    if (index !== sectionIndex || typeof item !== "object" || item === null || Array.isArray(item)) return item;
    const section = item as Prisma.JsonObject;
    const fieldIds = Array.isArray(section.fieldIds) ? section.fieldIds : [];
    return fieldIds.includes(fieldId) ? section : { ...section, fieldIds: [...fieldIds, fieldId] };
  }) as Prisma.InputJsonValue;
}

export function isPrismaUniqueError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
