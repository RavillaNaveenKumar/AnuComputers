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
    const columns = section.columns;
    return Array.isArray(columns)
      ? { ...section, columns: columns.map((value) => typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value, fieldIds: Array.isArray(value.fieldIds) ? value.fieldIds.filter((id) => typeof id === "string" && id !== fieldId) : [] } : value) }
      : Array.isArray(fieldIds) ? { ...section, fieldIds: fieldIds.filter((id) => typeof id === "string" && id !== fieldId) } : section;
  }) as Prisma.InputJsonValue;
}

export function addFieldToLayoutSections(sections: Prisma.JsonValue, fieldId: string): Prisma.InputJsonValue {
  if (!Array.isArray(sections) || sections.length === 0) return sections as Prisma.InputJsonValue;
  const sectionIndex = sections.findIndex((item) => typeof item === "object" && item !== null && !Array.isArray(item));
  if (sectionIndex < 0) return sections as Prisma.InputJsonValue;
  return sections.map((item, index) => {
    if (index !== sectionIndex || typeof item !== "object" || item === null || Array.isArray(item)) return item;
    const section = item as Prisma.JsonObject;
    if (Array.isArray(section.columns)) {
      const columns = section.columns.map((value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Prisma.JsonObject : {});
      const first = columns[0];
      if (first) {
        const fieldIds = Array.isArray(first.fieldIds) ? first.fieldIds : [];
        return { ...section, columns: columns.map((column, columnIndex) => columnIndex === 0 && !fieldIds.includes(fieldId) ? { ...column, fieldIds: [...fieldIds, fieldId] } : column) };
      }
      return { ...section, columns: [{ id: "column-1", fieldIds: [fieldId] }] };
    }
    const fieldIds = Array.isArray(section.fieldIds) ? section.fieldIds : [];
    return fieldIds.includes(fieldId) ? section : { ...section, fieldIds: [...fieldIds, fieldId] };
  }) as Prisma.InputJsonValue;
}

export function isPrismaUniqueError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
