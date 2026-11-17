import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasStandardRecordStore, syncStandardCrmFields } from "@/lib/crm-registry";
import { immutableCrmFieldName } from "@/lib/crm-field-metadata";
import { getCrmFieldCapabilities } from "@/lib/crm-app-access";
import { evaluateAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { getNativeCrmRecord, listNativeCrmRecords, nativeCrmLookupOptions, nativeRecordToJson } from "@/lib/native-crm-records";
import { createNativeCrmRecord, deleteNativeCrmRecord, NativeCrmRecordError, updateNativeCrmRecord } from "@/lib/native-crm-mutations";
import { parseCrmCsv } from "@/lib/crm-csv";
import type { RoleName } from "@/lib/permissions";

type AuthorizationUser = Parameters<typeof evaluateUserAuthorization>[0];
type CrmOperation = "canCreate" | "canRead" | "canEdit" | "canDelete";

type NativeField = {
  id: string;
  label: string;
  apiName: string;
  dataType: string;
  required: boolean;
  defaultValue: string | null;
  unique: boolean;
  protected: boolean;
  origin: "SYSTEM" | "STANDARD" | "CUSTOM";
  readOnly: boolean;
  isNameField: boolean;
  fieldLength: number | null;
  decimalPlaces: number | null;
  externalId: boolean;
  lookupTargetApiName: string | null;
  picklistValues: { value: string; label: string }[];
  relationship: {
    targetObjectId: string;
    targetObject: { id: string; apiName: string; pluralLabel: string; active: boolean; objectType: string };
  } | null;
};

const nativeReadOnlyFields: Record<string, Set<string>> = {
  Contact: new Set(["Name"]),
  Lead: new Set(["Reference"]),
  Quote: new Set(["Name", "Subtotal", "Total"]),
  QuoteLineItem: new Set(["SKU"]),
  Order: new Set(["Name", "QuoteId", "Status", "Subtotal", "Total", "OwnerId"]),
  OrderItem: new Set(["SKU"]),
  Case: new Set(["CaseNumber"]),
  CaseComment: new Set(["AuthorId", "CreatedAt"]),
};
const relatedObjectPermissions: Record<string, string[]> = {
  Contact: ["Account"],
  Lead: ["Account"],
  Quote: ["Account", "Lead", "Product"],
  QuoteLineItem: ["Quote", "Product"],
  Order: ["Account", "Product"],
  OrderItem: ["Order", "Product"],
  Case: ["Account", "Order"],
  CaseComment: ["Case"],
};

async function fieldCapabilitiesFor(user: { id: string; role: RoleName }, objectId: string, fieldIds: string[]) {
  return getCrmFieldCapabilities(user, objectId, fieldIds);
}

async function userHasObjectPermission(user: AuthorizationUser, apiName: string, capability: CrmOperation) {
  const authorization = await evaluateUserAuthorization(user, { objectApiName: apiName, objectCapability: capability });
  return authorization.allowed;
}

async function userHasObjectIdPermission(user: AuthorizationUser, objectId: string, capability: CrmOperation) {
  const authorization = await evaluateUserAuthorization(user, { objectId, objectCapability: capability });
  return authorization.allowed;
}

async function customLookupOptionsFor(user: AuthorizationUser, fields: NativeField[]) {
  const lookups: Record<string, { id: string; label: string }[]> = {};
  for (const field of fields) {
    if (field.protected || field.dataType !== "LOOKUP" || !field.relationship) continue;
    const target = field.relationship.targetObject;
    if (!target.active || !await userHasObjectIdPermission(user, target.id, "canRead")) continue;
    const targetFields = await prisma.crmField.findMany({
      where: { objectId: target.id, active: true },
      select: { id: true, apiName: true, dataType: true },
      orderBy: { position: "asc" },
    });
    const capabilities = await fieldCapabilitiesFor(user, target.id, targetFields.map(({ id }) => id));
    const readableFields = targetFields.filter((item) => capabilities.get(item.id)?.canRead);
    const labelField = ["Name", "Title", "Subject", "CaseNumber", "Reference", "ProductCode"].map((name) =>
      readableFields.find((item) => item.apiName === name)).find(Boolean)
      || readableFields.find((item) => ["TEXT", "TEXT_AREA", "AUTO_NUMBER"].includes(item.dataType));
    const records = hasStandardRecordStore(target.apiName)
      ? await listNativeCrmRecords(target.apiName, user, 500)
      : await prisma.crmRecord.findMany({
        where: { objectId: target.id },
        select: { id: true, data: true },
        orderBy: { updatedAt: "desc" },
        take: 500,
      }).then((items) => items.map((item) => ({ id: item.id, data: item.data as Record<string, unknown> })));
    lookups[field.apiName] = records.map((record) => {
      const label = labelField ? record.data[labelField.apiName] : null;
      return {
        id: record.id,
        label: typeof label === "string" && label.trim() ? label : `${target.pluralLabel} ${record.id.slice(0, 8)}`,
      };
    });
  }
  return lookups;
}

async function validateCustomLookups(data: Record<string, unknown>, fields: NativeField[], user: AuthorizationUser) {
  for (const field of fields) {
    const value = data[field.apiName];
    if (field.protected || field.dataType !== "LOOKUP" || value === undefined || value === null || value === "") continue;
    const target = field.relationship?.targetObject;
    if (!target?.active) return { error: `${field.label} has no active relationship target.`, status: 409 };
    if (typeof value !== "string") return { error: `${field.label} must reference a record id.` };
    if (!await userHasObjectIdPermission(user, target.id, "canRead")) {
      return { error: `You do not have read access to ${target.pluralLabel}.`, status: 403 };
    }
    const record = hasStandardRecordStore(target.apiName)
      ? await getNativeCrmRecord(target.apiName, value, user)
      : await prisma.crmRecord.findFirst({ where: { id: value, objectId: target.id }, select: { id: true } });
    if (!record) return { error: `${field.label} must reference an accessible ${target.pluralLabel} record.` };
  }
  return null;
}

async function childFieldsFor(user: AuthorizationUser, apiName: "QuoteLineItem" | "OrderItem") {
  const child = await prisma.crmObject.findFirst({
    where: { apiName, active: true, objectType: "STANDARD" },
    include: {
      fields: {
        where: { active: true },
        include: {
          picklistValues: { where: { active: true } },
          relationship: { include: { targetObject: { select: { id: true, apiName: true, pluralLabel: true, active: true, objectType: true } } } },
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!child) return null;
  const capabilities = await fieldCapabilitiesFor(user, child.id, child.fields.map(({ id }) => id));
  const [canRead, canCreate, canDelete] = await Promise.all([
    userHasObjectIdPermission(user, child.id, "canRead"),
    userHasObjectIdPermission(user, child.id, "canCreate"),
    userHasObjectIdPermission(user, child.id, "canDelete"),
  ]);
  return {
    objectId: child.id,
    fields: child.fields as NativeField[],
    readableFields: child.fields.filter((field) => capabilities.get(field.id)?.canRead),
    editableFields: child.fields.filter((field) => capabilities.get(field.id)?.canEdit),
    canRead,
    canCreate,
    canDelete,
  };
}

async function getAuthorizedObject(objectId: string, capability: "canRead" | "canCreate" | "canEdit" | "canDelete") {
  const sessionAuthorization = await evaluateAuthorization();
  if (!sessionAuthorization.allowed) {
    return { response: NextResponse.json({ error: sessionAuthorization.error }, { status: sessionAuthorization.status }) };
  }
  await syncStandardCrmFields(prisma);
  const { user } = sessionAuthorization;
  const object = await prisma.crmObject.findFirst({
    where: { id: objectId, active: true, objectType: "STANDARD" },
    include: {
      fields: {
        where: { active: true },
        include: {
          picklistValues: { where: { active: true } },
          fieldPermissions: true,
          relationship: { include: { targetObject: { select: { id: true, apiName: true, pluralLabel: true, active: true, objectType: true } } } },
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!object || !hasStandardRecordStore(object.apiName)) return { response: NextResponse.json({ error: "Native standard object not found." }, { status: 404 }) };
  const authorization = await evaluateUserAuthorization(user, { objectId: object.id, objectCapability: capability });
  if (!authorization.allowed) {
    return { response: NextResponse.json({ error: authorization.error }, { status: authorization.status }) };
  }
  return { user: authorization.user, object };
}

function validateRecord(data: unknown, fields: NativeField[], apiName: string) {
  const parsed = z.record(z.string(), z.unknown()).safeParse(data);
  if (!parsed.success) return { error: "Each record must be an object keyed by field API name." };
  const values = parsed.data;
  const allowed = new Map(fields.map((field) => [field.apiName, field]));
  for (const key of Object.keys(values)) {
    if (key === "Items" && ["Quote", "Order"].includes(apiName)) continue;
    if (!allowed.has(key)) return { error: `Unknown or inactive field: ${key}.` };
  }
  for (const field of fields) {
    const value = values[field.apiName];
    if (field.required && field.origin !== "SYSTEM" && field.dataType !== "AUTO_NUMBER" && !nativeReadOnlyFields[apiName]?.has(field.apiName) && (value === undefined || value === null || value === "")) {
      return { error: `${field.label} is required.` };
    }
    if (value === undefined || value === null || value === "") continue;
    if (["ID", "TEXT", "TEXT_AREA", "LONG_TEXT_AREA", "EMAIL", "PHONE", "URL", "DATE", "DATETIME", "PICKLIST", "AUTO_NUMBER", "LOOKUP"].includes(field.dataType) && typeof value !== "string") {
      return { error: `${field.label} must be text.` };
    }
    if (field.fieldLength && typeof value === "string" && value.length > field.fieldLength) {
      return { error: `${field.label} cannot exceed ${field.fieldLength} characters.` };
    }
    if (["NUMBER", "CURRENCY", "PERCENT"].includes(field.dataType) && (typeof value !== "number" || !Number.isFinite(value))) {
      return { error: `${field.label} must be numeric.` };
    }
    if (field.decimalPlaces !== null && field.decimalPlaces !== undefined && typeof value === "number" && Number(value.toFixed(field.decimalPlaces)) !== value) {
      return { error: `${field.label} supports at most ${field.decimalPlaces} decimal places.` };
    }
    if (field.dataType === "CHECKBOX" && typeof value !== "boolean") return { error: `${field.label} must be true or false.` };
    if (field.dataType === "MULTI_SELECT_PICKLIST" && (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))) {
      return { error: `${field.label} must be a list of values.` };
    }
    if (["PICKLIST", "MULTI_SELECT_PICKLIST"].includes(field.dataType)) {
      const choices = Array.isArray(value) ? value : [value];
      const allowedValues = new Set(field.picklistValues.map(({ value: pick }) => pick));
      if (choices.some((choice) => typeof choice !== "string" || !allowedValues.has(choice))) return { error: `${field.label} contains an invalid choice.` };
    }
  }
  if (["Quote", "Order"].includes(apiName) && (!Array.isArray(values.Items) || !values.Items.length)) {
    return { error: "Add at least one line item." };
  }
  return { data: values };
}

function withFieldDefaults(data: Record<string, unknown>, fields: NativeField[]) {
  const result = { ...data };
  for (const field of fields) {
    if (result[field.apiName] !== undefined || field.defaultValue === null || field.origin === "SYSTEM" || field.dataType === "AUTO_NUMBER") continue;
    if (["NUMBER", "CURRENCY", "PERCENT"].includes(field.dataType)) result[field.apiName] = Number(field.defaultValue);
    else if (field.dataType === "CHECKBOX") result[field.apiName] = field.defaultValue === "true";
    else if (field.dataType === "MULTI_SELECT_PICKLIST") {
      try {
        const parsed: unknown = JSON.parse(field.defaultValue);
        result[field.apiName] = Array.isArray(parsed) ? parsed : [field.defaultValue];
      } catch {
        result[field.apiName] = field.defaultValue.split(",").map((value) => value.trim()).filter(Boolean);
      }
    }
    else result[field.apiName] = field.defaultValue;
  }
  return result;
}

function validateNestedLineItems(data: unknown, apiName: "QuoteLineItem" | "OrderItem", fields: NativeField[], editableFields: Set<string>) {
  if (!Array.isArray(data) || !data.length) return { error: "Add at least one line item." };
  const parentField = apiName === "QuoteLineItem" ? "QuoteId" : "OrderId";
  const items: Record<string, unknown>[] = [];
  for (const [index, raw] of data.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: `Line item ${index + 1} must be an object.` };
    const item = raw as Record<string, unknown>;
    const readOnlyField = immutableCrmFieldName(item, fields);
    if (readOnlyField) return { error: `Line item ${index + 1}: ${readOnlyField} is read-only and is generated by the server.` };
    const descriptionMissing = item.Description === undefined || item.Description === null || item.Description === "";
    const validated = validateRecord(withFieldDefaults({
      ...item,
      [parentField]: "pending-parent",
      ...(descriptionMissing ? { Description: "pending-description" } : {}),
    }, fields), fields, apiName);
    if ("error" in validated) return { error: `Line item ${index + 1}: ${validated.error}` };
    const forbiddenField = Object.keys(item).find((key) =>
      !nativeReadOnlyFields[apiName]?.has(key) && !editableFields.has(key) &&
      item[key] !== undefined && item[key] !== null && item[key] !== "");
    if (forbiddenField) return { error: `You do not have edit access to line item field ${forbiddenField}.`, status: 403 };
    delete validated.data[parentField];
    if (descriptionMissing) delete validated.data.Description;
    items.push(validated.data);
  }
  return { items };
}

function parseCsv(content: string, fields: NativeField[], apiName: string): { error: string; row?: number } | { records: Record<string, unknown>[] } {
  let rows: string[][];
  try { rows = parseCrmCsv(content); } catch (error) {
    return { error: error instanceof Error ? error.message : "The CSV is invalid." };
  }
  if (rows.length < 2) return { error: "The CSV must include a header and at least one record." };
  const fieldsByName = new Map(fields.flatMap((field) => [[field.apiName, field], [field.label, field]]));
  const headers = rows[0].map((header) => header.trim());
  const records = rows.slice(1).map((cells, rowIndex) => {
    const record: Record<string, unknown> = {};
    for (const [index, header] of headers.entries()) {
      const value = cells[index] ?? "";
      if (header === "Items" && ["Quote", "Order"].includes(apiName)) {
        if (value) {
          try { record.Items = JSON.parse(value); } catch { return { row: rowIndex + 2, error: "Items must contain valid JSON." }; }
        }
        continue;
      }
      const field = fieldsByName.get(header);
      if (!field) return { row: rowIndex + 2, error: `Unknown CSV column: ${header}.` };
      if (!value) {
        record[field.apiName] = "";
      } else if (["NUMBER", "CURRENCY", "PERCENT"].includes(field.dataType)) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return { row: rowIndex + 2, error: `${field.label} must be numeric.` };
        record[field.apiName] = numeric;
      } else if (field.dataType === "CHECKBOX") {
        if (!["true", "false"].includes(value.toLowerCase())) return { row: rowIndex + 2, error: `${field.label} must be true or false.` };
        record[field.apiName] = value.toLowerCase() === "true";
      } else if (field.dataType === "MULTI_SELECT_PICKLIST") {
        try {
          const parsed = JSON.parse(value);
          record[field.apiName] = Array.isArray(parsed) ? parsed : value.split(";").map((item) => item.trim()).filter(Boolean);
        } catch {
          record[field.apiName] = value.split(";").map((item) => item.trim()).filter(Boolean);
        }
      } else {
        record[field.apiName] = value;
      }
    }
    return record;
  });
  const firstError = records.find((item) => "error" in item);
  if (firstError && "error" in firstError) {
    return {
      error: typeof firstError.error === "string" ? firstError.error : "The CSV contains an invalid row.",
      row: typeof firstError.row === "number" ? firstError.row : undefined,
    };
  }
  return { records: records as Record<string, unknown>[] };
}

function splitFieldValues(data: Record<string, unknown>, fields: NativeField[], changed?: Set<string>) {
  const nativeData: Record<string, unknown> = {};
  const customValues: { fieldId: string; value: Prisma.InputJsonValue }[] = [];
  for (const field of fields) {
    if (!Object.hasOwn(data, field.apiName) || (changed && !changed.has(field.apiName))) continue;
    if (field.dataType === "AUTO_NUMBER") continue;
    if (field.protected) nativeData[field.apiName] = data[field.apiName];
    else customValues.push({ fieldId: field.id, value: (data[field.apiName] ?? "") as Prisma.InputJsonValue });
  }
  if (Object.hasOwn(data, "Items")) nativeData.Items = data.Items;
  return { nativeData, customValues };
}

class PreviewRollback extends Error {}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : Array.isArray(value) ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

export async function GET(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await context.params;
  const auth = await getAuthorizedObject(objectId, "canRead");
  if ("response" in auth) return auth.response;
  const searchParams = new URL(request.url).searchParams;
  const isCsv = searchParams.get("format") === "csv";
  const recordId = searchParams.get("recordId") || undefined;
  const capabilities = await fieldCapabilitiesFor(auth.user, auth.object.id, auth.object.fields.map(({ id }) => id));
  const fields = auth.object.fields.filter((field) => capabilities.get(field.id)?.canRead);
  const [records, builtInLookups] = await Promise.all([
    listNativeCrmRecords(auth.object.apiName, auth.user, isCsv ? 10001 : recordId ? 1 : 1000, recordId),
    nativeCrmLookupOptions(auth.object.apiName, auth.user),
  ]);
  const lookups = { ...builtInLookups, ...await customLookupOptionsFor(auth.user, fields as NativeField[]) };
  const allowedLookups = { ...lookups };
  const lookupTargets: Record<string, string> = {
    AccountId: "Account",
    LeadId: "Lead",
    QuoteId: "Quote",
    OrderId: "Order",
    ProductId: "Product",
    CaseId: "Case",
  };
  for (const [fieldName, targetApiName] of Object.entries(lookupTargets)) {
    if (allowedLookups[fieldName] && !await userHasObjectPermission(auth.user, targetApiName, "canRead")) delete allowedLookups[fieldName];
  }
  const targetApiNames = [...new Set([
    ...Object.values(lookupTargets),
    ...auth.object.fields.flatMap((field) => field.relationship ? [field.relationship.targetObject.apiName] : []),
  ])];
  const targetObjects = await prisma.crmObject.findMany({
    where: { apiName: { in: targetApiNames }, active: true },
    select: { id: true, apiName: true },
  });
  const objectIds: Record<string, string> = {};
  for (const target of targetObjects) {
    if (await userHasObjectIdPermission(auth.user, target.id, "canRead")) objectIds[target.apiName] = target.id;
  }
  if (isCsv && records.length > 10000) return NextResponse.json({ error: "This export exceeds 10,000 rows. Export a smaller set using a filtered list." }, { status: 413 });
  const recordIds = records.map(({ id }) => id);
  const customValues = recordIds.length && fields.length
    ? await prisma.crmNativeFieldValue.findMany({
      where: { objectApiName: auth.object.apiName, recordId: { in: recordIds }, fieldId: { in: fields.map(({ id }) => id) } },
      select: { recordId: true, fieldId: true, value: true },
    })
    : [];
  const valuesByRecord = new Map<string, Record<string, unknown>>();
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  for (const customValue of customValues) {
    const field = fieldById.get(customValue.fieldId);
    if (!field) continue;
    const values = valuesByRecord.get(customValue.recordId) ?? {};
    values[field.apiName] = customValue.value;
    valuesByRecord.set(customValue.recordId, values);
  }
  const payloadRecords = records.map((record) => {
    const custom = valuesByRecord.get(record.id) ?? {};
    return {
      ...nativeRecordToJson(record),
      canManageShares: auth.user.role === "ADMIN" || record.ownerId === auth.user.id,
      data: Object.fromEntries(fields.map((field) => [
        field.apiName,
        lookupTargets[field.apiName] && !objectIds[lookupTargets[field.apiName]]
          ? null
          : Object.hasOwn(custom, field.apiName) ? custom[field.apiName] : record.data[field.apiName] ?? null,
      ])),
    };
  });

  if (isCsv) {
    const childApiName = auth.object.apiName === "Quote" ? "QuoteLineItem" : auth.object.apiName === "Order" ? "OrderItem" : null;
    const childInfo = childApiName ? await childFieldsFor(auth.user, childApiName) : null;
    const childFields = childInfo?.canRead ? childInfo.readableFields : [];
    const itemsByParent = new Map<string, Record<string, unknown>[]>();
    let childRows: { id: string; parentId: string; data: Record<string, unknown> }[] = [];
    if (auth.object.apiName === "Quote" && childFields.length) {
      const items = await prisma.quoteItem.findMany({
        where: { quoteId: { in: recordIds } },
        select: { id: true, quoteId: true, productId: true, skuSnapshot: true, description: true, quantity: true, unitPrice: true, discount: true },
      });
      childRows = items.map((item) => ({
        id: item.id,
        parentId: item.quoteId,
        data: { ProductId: item.productId, SKU: item.skuSnapshot, Description: item.description, Quantity: item.quantity, UnitPrice: Number(item.unitPrice), Discount: Number(item.discount) },
      }));
    } else if (auth.object.apiName === "Order" && childFields.length) {
      const items = await prisma.orderItem.findMany({
        where: { orderId: { in: recordIds } },
        select: { id: true, orderId: true, productId: true, skuSnapshot: true, description: true, quantity: true, unitPrice: true },
      });
      childRows = items.map((item) => ({
        id: item.id,
        parentId: item.orderId,
        data: { ProductId: item.productId, SKU: item.skuSnapshot, Description: item.description, Quantity: item.quantity, UnitPrice: Number(item.unitPrice), Discount: 0 },
      }));
    }
    if (childApiName && childFields.length && childRows.length) {
      const customChildFields = childFields.filter((field) => !field.protected);
      const childCustomValues = customChildFields.length
        ? await prisma.crmNativeFieldValue.findMany({
          where: { objectApiName: childApiName, recordId: { in: childRows.map(({ id }) => id) }, fieldId: { in: customChildFields.map(({ id }) => id) } },
          select: { recordId: true, fieldId: true, value: true },
        })
        : [];
      const childFieldById = new Map(customChildFields.map((field) => [field.id, field]));
      const childCustomById = new Map<string, Record<string, unknown>>();
      for (const value of childCustomValues) {
        const field = childFieldById.get(value.fieldId);
        if (field) childCustomById.set(value.recordId, { ...(childCustomById.get(value.recordId) ?? {}), [field.apiName]: value.value });
      }
      for (const item of childRows) {
        const custom = childCustomById.get(item.id) ?? {};
        const data = Object.fromEntries(childFields.map((field) => [
          field.apiName,
          Object.hasOwn(custom, field.apiName) ? custom[field.apiName] : item.data[field.apiName] ?? null,
        ]));
        itemsByParent.set(item.parentId, [...(itemsByParent.get(item.parentId) ?? []), data]);
      }
    }
    const exportFields = [...fields, ...(childFields.length ? [{ apiName: "Items" }] : [])];
    const header = exportFields.map(({ apiName }) => csvCell(apiName)).join(",");
    const lines = payloadRecords.map(({ id, data }) => exportFields.map(({ apiName }) => csvCell(apiName === "Items" ? itemsByParent.get(id) ?? [] : data[apiName])).join(","));
    return new Response([header, ...lines].join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${auth.object.apiName.toLowerCase()}-records.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const childObject = auth.object.apiName === "Quote" ? "QuoteLineItem" : auth.object.apiName === "Order" ? "OrderItem" : null;
  const [canCreateObject, canEditObject, canDeleteObject, canCreateChild, canDeleteChild] = await Promise.all([
    userHasObjectIdPermission(auth.user, auth.object.id, "canCreate"),
    userHasObjectIdPermission(auth.user, auth.object.id, "canEdit"),
    userHasObjectIdPermission(auth.user, auth.object.id, "canDelete"),
    childObject ? userHasObjectPermission(auth.user, childObject, "canCreate") : Promise.resolve(true),
    childObject ? userHasObjectPermission(auth.user, childObject, "canDelete") : Promise.resolve(true),
  ]);
  return NextResponse.json({
    object: {
      id: auth.object.id,
      name: auth.object.name,
      pluralLabel: auth.object.pluralLabel,
      apiName: auth.object.apiName,
      displayFieldApiName: auth.object.displayFieldApiName,
      fields: fields.map(({ id, label, apiName, dataType, required, defaultValue, unique, origin, readOnly, isNameField, fieldLength, decimalPlaces, externalId, lookupTargetApiName, picklistValues, relationship }) => ({
        id,
        label,
        apiName,
        dataType,
        required,
        defaultValue,
        unique,
        origin,
        readOnly,
        isNameField,
        fieldLength,
        decimalPlaces,
        externalId,
        lookupTargetApiName,
        canEdit: (capabilities.get(id)?.canEdit ?? false) && !readOnly && !nativeReadOnlyFields[auth.object.apiName]?.has(apiName),
        relationship: relationship ? {
          targetObjectId: relationship.targetObjectId,
          targetApiName: relationship.targetObject.apiName,
          targetPluralLabel: relationship.targetObject.pluralLabel,
        } : null,
        picklistValues: picklistValues.map(({ value, label: pickLabel }) => ({ value, label: pickLabel })),
      })),
    },
    capabilities: {
      canCreate: canCreateObject && canCreateChild,
      canRead: true,
      canEdit: canEditObject,
      canDelete: canDeleteObject && canDeleteChild,
    },
    lookups: allowedLookups,
    objectIds,
    records: payloadRecords,
    truncated: records.length === 1000,
  });
}

export async function POST(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await context.params;
  const auth = await getAuthorizedObject(objectId, "canCreate");
  if ("response" in auth) return auth.response;
  for (const apiName of relatedObjectPermissions[auth.object.apiName] || []) {
    if (!await userHasObjectPermission(auth.user, apiName, "canRead")) {
      return NextResponse.json({ error: `You need read access to ${apiName} records to manage ${auth.object.name}.` }, { status: 403 });
    }
  }
  const childCreateObject = auth.object.apiName === "Quote" ? "QuoteLineItem" : auth.object.apiName === "Order" ? "OrderItem" : null;
  const childInfo = childCreateObject ? await childFieldsFor(auth.user, childCreateObject) : null;
  if (childCreateObject && !childInfo?.canCreate) {
    return NextResponse.json({ error: `You do not have create access to ${childCreateObject} records.` }, { status: 403 });
  }
  const fieldCapabilities = await fieldCapabilitiesFor(auth.user, auth.object.id, auth.object.fields.map(({ id }) => id));
  const fields = auth.object.fields as NativeField[];
  let body: Record<string, unknown> | null = null;
  let rows: unknown[];
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("text/csv")) {
    const parsedCsv = parseCsv(await request.text(), fields, auth.object.apiName);
    if ("error" in parsedCsv) return NextResponse.json({ error: parsedCsv.error, row: "row" in parsedCsv ? parsedCsv.row : undefined }, { status: 400 });
    rows = parsedCsv.records;
  } else {
    body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Import data must be an object." }, { status: 400 });
    rows = Array.isArray(body.records) ? body.records : [body.data ?? body];
  }
  if (!rows.length || rows.length > 500) return NextResponse.json({ error: "Import between 1 and 500 records at a time." }, { status: 400 });
  const editableNames = new Set(auth.object.fields.filter((field) => fieldCapabilities.get(field.id)?.canEdit).map(({ apiName }) => apiName));
  const validatedRows: Record<string, unknown>[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsedRaw = z.record(z.string(), z.unknown()).safeParse(raw);
    if (!parsedRaw.success) return NextResponse.json({ error: `Row ${index + 1}: Each record must be an object keyed by field API name.` }, { status: 400 });
    const readOnlyField = immutableCrmFieldName(parsedRaw.data, fields);
    if (readOnlyField) return NextResponse.json({ error: `Row ${index + 1}: ${readOnlyField} is read-only and is generated by the server.` }, { status: 400 });
    const validated = validateRecord(withFieldDefaults(parsedRaw.data, fields), fields, auth.object.apiName);
    if ("error" in validated) return NextResponse.json({ error: `Row ${index + 1}: ${validated.error}` }, { status: 400 });
    const lookupError = await validateCustomLookups(validated.data, fields, auth.user);
    if (lookupError) return NextResponse.json({ error: `Row ${index + 1}: ${lookupError.error}` }, { status: "status" in lookupError ? lookupError.status : 400 });
    if (childCreateObject && childInfo) {
      const lineItems = validateNestedLineItems(validated.data.Items, childCreateObject, childInfo.fields, new Set(childInfo.editableFields.map(({ apiName }) => apiName)));
      if ("error" in lineItems) return NextResponse.json({ error: `Row ${index + 1}: ${lineItems.error}` }, { status: "status" in lineItems ? lineItems.status : 400 });
      for (const [lineIndex, item] of lineItems.items.entries()) {
        const childLookupError = await validateCustomLookups(item, childInfo.fields, auth.user);
        if (childLookupError) return NextResponse.json({ error: `Row ${index + 1}, line item ${lineIndex + 1}: ${childLookupError.error}` }, { status: "status" in childLookupError ? childLookupError.status : 400 });
      }
      validated.data.Items = lineItems.items;
    }
    const forbiddenField = Object.keys(validated.data).find((key) => key !== "Items" && key !== "Id" && key !== "CreatedAt" && key !== "UpdatedAt" &&
      fields.find((field) => field.apiName === key)?.dataType !== "AUTO_NUMBER" && !editableNames.has(key) &&
      validated.data[key] !== undefined && validated.data[key] !== null && validated.data[key] !== "" &&
      !nativeReadOnlyFields[auth.object.apiName]?.has(key) && !editableNames.has(key));
    if (forbiddenField) return NextResponse.json({ error: `You do not have edit access to ${forbiddenField}.` }, { status: 403 });
    validatedRows.push(validated.data);
  }
  const previewOnly = body?.preview === true || new URL(request.url).searchParams.get("preview") === "true";
  let currentRow = 0;
  try {
    const ids = await prisma.$transaction(async (tx) => {
      const created: string[] = [];
      for (const record of validatedRows) {
        const { nativeData, customValues } = splitFieldValues(record, fields);
        const childFieldValues = childInfo && Array.isArray(record.Items)
          ? record.Items.map((item) => splitFieldValues(item as Record<string, unknown>, childInfo.fields).customValues)
          : [];
        created.push(await createNativeCrmRecord(auth.object.apiName, nativeData, auth.user, customValues, tx, childFieldValues));
        currentRow++;
      }
      if (previewOnly) throw new PreviewRollback();
      return created;
    });
    return NextResponse.json({ count: ids.length, ids }, { status: 201 });
  } catch (error) {
    if (previewOnly && error instanceof PreviewRollback) return NextResponse.json({ valid: true, count: validatedRows.length });
    if (error instanceof NativeCrmRecordError) return NextResponse.json({ error: `Row ${currentRow + 1}: ${error.message}` }, { status: error.status });
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: `Row ${currentRow + 1}: A record with the same unique value already exists.` }, { status: 409 });
    }
    throw error;
  }
}

export async function PUT(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await context.params;
  const auth = await getAuthorizedObject(objectId, "canEdit");
  if ("response" in auth) return auth.response;
  for (const apiName of relatedObjectPermissions[auth.object.apiName] || []) {
    if (!await userHasObjectPermission(auth.user, apiName, "canRead")) {
      return NextResponse.json({ error: `You need read access to ${apiName} records to manage ${auth.object.name}.` }, { status: 403 });
    }
  }
  const body: unknown = await request.json().catch(() => null);
  const parsed = z.object({ id: z.string().min(1), data: z.record(z.string(), z.unknown()) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Record id and data are required." }, { status: 400 });
  if ("Items" in parsed.data.data) return NextResponse.json({ error: "Edit quote and order line items from their related object records." }, { status: 409 });
  const fields = auth.object.fields as NativeField[];
  const readOnlyField = immutableCrmFieldName(parsed.data.data, fields);
  if (readOnlyField) return NextResponse.json({ error: `${readOnlyField} is read-only and is generated by the server.` }, { status: 400 });
  const existing = await getNativeCrmRecord(auth.object.apiName, parsed.data.id, auth.user, "edit");
  if (!existing) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  const existingCustom = await prisma.crmNativeFieldValue.findMany({
    where: { objectApiName: auth.object.apiName, recordId: existing.id, fieldId: { in: fields.map(({ id }) => id) } },
    select: { fieldId: true, value: true },
  });
  const customById = new Map(existingCustom.map(({ fieldId, value }) => [fieldId, value]));
  const currentData = Object.fromEntries(fields.map((field) => [
    field.apiName,
    field.protected ? existing.data[field.apiName] ?? null : customById.get(field.id) ?? null,
  ]));
  const merged = { ...currentData, ...parsed.data.data };
  const validated = validateRecord(merged, fields, auth.object.apiName);
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const lookupError = await validateCustomLookups(validated.data, fields, auth.user);
  if (lookupError) return NextResponse.json({ error: lookupError.error }, { status: "status" in lookupError ? lookupError.status : 400 });
  const fieldCapabilities = await fieldCapabilitiesFor(auth.user, auth.object.id, auth.object.fields.map(({ id }) => id));
  const changed = new Set<string>();
  for (const field of fields) {
    if (JSON.stringify(currentData[field.apiName]) !== JSON.stringify(validated.data[field.apiName])) {
      if (nativeReadOnlyFields[auth.object.apiName]?.has(field.apiName) || !fieldCapabilities.get(field.id)?.canEdit) {
        return NextResponse.json({ error: `${field.label} is read-only.` }, { status: 403 });
      }
      changed.add(field.apiName);
    }
  }
  const { nativeData, customValues } = splitFieldValues(validated.data, fields, changed);
  try {
    await updateNativeCrmRecord(auth.object.apiName, existing.id, nativeData, auth.user, customValues);
    return NextResponse.json({ id: existing.id });
  } catch (error) {
    if (error instanceof NativeCrmRecordError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "A record with the same unique value already exists." }, { status: 409 });
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") return NextResponse.json({ error: "Record not found." }, { status: 404 });
    throw error;
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await context.params;
  const auth = await getAuthorizedObject(objectId, "canDelete");
  if ("response" in auth) return auth.response;
  const childDeleteObject = auth.object.apiName === "Quote" ? "QuoteLineItem" : auth.object.apiName === "Order" ? "OrderItem" : null;
  if (childDeleteObject && !await userHasObjectPermission(auth.user, childDeleteObject, "canDelete")) {
    return NextResponse.json({ error: `You do not have delete access to ${childDeleteObject} records.` }, { status: 403 });
  }
  const ids = z.array(z.string().min(1)).min(1).max(500).safeParse((await request.json().catch(() => null))?.ids);
  if (!ids.success) return NextResponse.json({ error: "Select between 1 and 500 record ids." }, { status: 400 });
  const deleted: string[] = [];
  const blocked: { id: string; error: string }[] = [];
  for (const id of ids.data) {
    try {
      await deleteNativeCrmRecord(auth.object.apiName, id, auth.user);
      deleted.push(id);
    } catch (error) {
      if (error instanceof NativeCrmRecordError) blocked.push({ id, error: error.message });
      else if (error && typeof error === "object" && "code" in error && error.code === "P2025") blocked.push({ id, error: "Record not found." });
      else throw error;
    }
  }
  return NextResponse.json({ deleted: deleted.length, deletedIds: deleted, blocked });
}
