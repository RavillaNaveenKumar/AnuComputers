import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allocateCrmAutoNumber } from "@/lib/crm-auto-number";
import { immutableCrmFieldName } from "@/lib/crm-field-metadata";
import { hasStandardRecordStore, syncStandardCrmFields } from "@/lib/crm-registry";
import { getCrmFieldCapabilities, getCrmObjectCapabilities } from "@/lib/crm-app-access";
import { evaluateAuthorization } from "@/lib/authorization";
import { filterAccessibleCrmRecords } from "@/lib/crm-record-access";
import { resolveCrmPageLayout } from "@/lib/crm-page-layout";
import { getNativeCrmRecord, listNativeCrmRecords } from "@/lib/native-crm-records";
import type { RoleName } from "@/lib/permissions";

const dataSchema = z.record(z.string(), z.unknown());
const paramsSchema = z.object({ objectId: z.string().min(1) });
type RegistryObject = NonNullable<Awaited<ReturnType<typeof getObject>>>;

class CrmRecordConstraintError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function authorize(objectId: string, capability: "canRead" | "canCreate" | "canEdit" | "canDelete") {
  const authorization = await evaluateAuthorization({ objectId, objectCapability: capability });
  if (!authorization.allowed) {
    return { response: NextResponse.json({ error: authorization.error }, { status: authorization.status }) };
  }
  return { user: authorization.user };
}

async function capabilitiesFor(user: { id: string; role: RoleName }, objectId: string) {
  return getCrmObjectCapabilities(user, objectId);
}

async function getObject(objectId: string) {
  await syncStandardCrmFields(prisma);
  return prisma.crmObject.findUnique({
    where: { id: objectId },
    include: {
      fields: {
        where: { active: true },
        include: {
          picklistValues: { where: { active: true } },
          relationship: { include: { targetObject: { select: { id: true, name: true, pluralLabel: true, apiName: true, active: true } } } },
        },
        orderBy: { position: "asc" },
      },
    },
  });
}

function usesRegistryRecords(object: NonNullable<Awaited<ReturnType<typeof getObject>>>) {
  return object.objectType === "CUSTOM" || (object.objectType === "STANDARD" && !hasStandardRecordStore(object.apiName));
}

function immutableFieldName(object: RegistryObject, data: Record<string, unknown>) {
  return immutableCrmFieldName(data, object.fields);
}

function withFieldDefaults(object: RegistryObject, data: Record<string, unknown>) {
  const result = { ...data };
  for (const field of object.fields) {
    if (result[field.apiName] !== undefined || field.defaultValue === null || field.origin === "SYSTEM") continue;
    if (field.dataType === "NUMBER" || field.dataType === "CURRENCY" || field.dataType === "PERCENT") {
      result[field.apiName] = Number(field.defaultValue);
    } else if (field.dataType === "CHECKBOX") {
      result[field.apiName] = field.defaultValue === "true";
    } else if (field.dataType === "MULTI_SELECT_PICKLIST") {
      try {
        const parsed: unknown = JSON.parse(field.defaultValue);
        result[field.apiName] = Array.isArray(parsed) ? parsed : [field.defaultValue];
      } catch {
        result[field.apiName] = field.defaultValue.split(",").map((value) => value.trim()).filter(Boolean);
      }
    } else {
      result[field.apiName] = field.defaultValue;
    }
  }
  return result;
}

async function withOpportunityAccountDefault(object: RegistryObject, data: Record<string, unknown>) {
  if (object.apiName !== "Opportunity" || typeof data.LeadId !== "string" || (typeof data.AccountId === "string" && data.AccountId)) return data;
  const lead = await prisma.lead.findUnique({ where: { id: data.LeadId }, select: { customerId: true } });
  return lead?.customerId ? { ...data, AccountId: lead.customerId } : data;
}

function systemFieldValues(record: {
  id: string;
  ownerId: string | null;
  createdById: string | null;
  lastModifiedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    Id: record.id,
    CreatedById: record.createdById,
    CreatedDate: record.createdAt.toISOString(),
    LastModifiedById: record.lastModifiedById,
    LastModifiedDate: record.updatedAt.toISOString(),
    OwnerId: record.ownerId,
    SystemModstamp: record.updatedAt.toISOString(),
  };
}

function validateRecord(object: RegistryObject, value: unknown) {
  const parsed = dataSchema.safeParse(value);
  if (!parsed.success) return { error: "Record data must be an object keyed by field API name." };
  const data = parsed.data;
  const allowed = new Map(object.fields.map((field) => [field.apiName, field]));
  for (const key of Object.keys(data)) if (!allowed.has(key)) return { error: `Unknown or inactive field: ${key}.` };
  for (const field of object.fields) {
    if (field.origin === "SYSTEM") continue;
    const item = data[field.apiName];
    if (field.required && field.dataType !== "AUTO_NUMBER" && (item === undefined || item === null || item === "")) return { error: `${field.label} is required.` };
    if (item === undefined || item === null || item === "") continue;
    if (["TEXT", "TEXT_AREA", "LONG_TEXT_AREA", "EMAIL", "PHONE", "URL", "DATE", "DATETIME", "PICKLIST", "AUTO_NUMBER", "LOOKUP"].includes(field.dataType) && typeof item !== "string") return { error: `${field.label} must be text.` };
    if (field.fieldLength && typeof item === "string" && item.length > field.fieldLength) return { error: `${field.label} cannot exceed ${field.fieldLength} characters.` };
    if (["NUMBER", "CURRENCY", "PERCENT"].includes(field.dataType) && (typeof item !== "number" || !Number.isFinite(item))) return { error: `${field.label} must be numeric.` };
    if (field.decimalPlaces !== null && field.decimalPlaces !== undefined && typeof item === "number" && Number(item.toFixed(field.decimalPlaces)) !== item) {
      return { error: `${field.label} supports at most ${field.decimalPlaces} decimal places.` };
    }
    if (field.dataType === "CHECKBOX" && typeof item !== "boolean") return { error: `${field.label} must be true or false.` };
    if (field.dataType === "MULTI_SELECT_PICKLIST" && (!Array.isArray(item) || item.some((entry) => typeof entry !== "string"))) return { error: `${field.label} must be a list of values.` };
    if (["PICKLIST", "MULTI_SELECT_PICKLIST"].includes(field.dataType)) {
      const allowedValues = new Set(field.picklistValues.map(({ value: pick }) => pick));
      const choices = Array.isArray(item) ? item : [item];
      if (choices.some((choice) => typeof choice !== "string" || !allowedValues.has(choice))) return { error: `${field.label} contains an invalid choice.` };
    }
  }
  return { data: data as Record<string, unknown> };
}

async function lookupDataFor(user: { id: string; role: RoleName }, object: RegistryObject) {
  const lookups: Record<string, { id: string; label: string }[]> = {};
  const objectIds: Record<string, string> = {};
  for (const field of object.fields) {
    const target = field.relationship?.targetObject;
    if (field.dataType !== "LOOKUP" || !target?.active) continue;
    if (!(await capabilitiesFor(user, target.id)).canRead) continue;
    const targetObject = await getObject(target.id);
    if (!targetObject?.active) continue;
    objectIds[targetObject.apiName] = targetObject.id;
    const displayField = targetObject.fields.find(({ apiName }) => apiName === targetObject.displayFieldApiName);
    const displayFieldAccess = displayField
      ? await getCrmFieldCapabilities(user, targetObject.id, [displayField.id])
      : new Map();
    const canReadDisplayField = displayField ? displayFieldAccess.get(displayField.id)?.canRead === true : false;
    const records = hasStandardRecordStore(targetObject.apiName)
      ? await listNativeCrmRecords(targetObject.apiName, user, 500)
      : await prisma.crmRecord.findMany({
        where: { objectId: targetObject.id },
        orderBy: { updatedAt: "desc" },
        take: 500,
      }).then((items) => filterAccessibleCrmRecords(user, targetObject.id, items, "read"));
    const leadCustomers = object.apiName === "Opportunity" && field.apiName === "LeadId" && records.length
      ? await prisma.lead.findMany({
        where: { id: { in: records.map(({ id }) => id) } },
        select: { id: true, customerId: true },
      })
      : [];
    const customerByLeadId = new Map(leadCustomers.map(({ id, customerId }) => [id, customerId]));
    lookups[field.apiName] = records.map((record) => {
      const recordData = record.data && typeof record.data === "object" && !Array.isArray(record.data)
        ? record.data as Record<string, unknown>
        : null;
      const label = canReadDisplayField && displayField && recordData
        ? recordData[displayField.apiName]
        : null;
      return {
        id: record.id,
        label: typeof label === "string" && label.trim() ? label : `${targetObject.pluralLabel} ${record.id.slice(0, 8)}`,
        ...(object.apiName === "Opportunity" && field.apiName === "LeadId"
          ? { customerId: customerByLeadId.get(record.id) ?? (typeof recordData?.AccountId === "string" ? recordData.AccountId : null) }
          : {}),
      };
    });
  }
  return { lookups, objectIds };
}

async function validateLookupValues(
  user: { id: string; role: RoleName },
  object: RegistryObject,
  data: Record<string, unknown>,
) {
  for (const field of object.fields) {
    if (field.dataType !== "LOOKUP" || field.origin === "SYSTEM") continue;
    const value = data[field.apiName];
    if (value === undefined || value === null || value === "") continue;
    const target = field.relationship?.targetObject;
    if (!target?.active) return { error: `${field.label} has no active relationship target.`, status: 409 };
    if (typeof value !== "string") return { error: `${field.label} must reference a record id.`, status: 400 };
    if (!(await capabilitiesFor(user, target.id)).canRead) return { error: `You do not have read access to ${target.pluralLabel}.`, status: 403 };
    const record = hasStandardRecordStore(target.apiName)
      ? await getNativeCrmRecord(target.apiName, value, user)
      : await prisma.crmRecord.findFirst({ where: { id: value, objectId: target.id } }).then(async (item) =>
        item && (await filterAccessibleCrmRecords(user, target.id, [item], "read")).length ? item : null);
    if (!record) return { error: `${field.label} must reference an accessible ${target.pluralLabel} record.`, status: 400 };
  }
  return null;
}

async function allocateAutoNumbers(tx: Prisma.TransactionClient, object: RegistryObject, data: Record<string, unknown>) {
  const result = { ...data };
  for (const field of object.fields) {
    if (field.dataType !== "AUTO_NUMBER") continue;
    result[field.apiName] = await allocateCrmAutoNumber(tx, field);
  }
  return result;
}

async function ensureUniqueValues(
  tx: Prisma.TransactionClient,
  objectId: string,
  data: Record<string, unknown>,
  fields: RegistryObject["fields"],
  excludeRecordId?: string,
) {
  const uniqueFields = fields.filter((field) =>
    field.unique && field.origin !== "SYSTEM" &&
    data[field.apiName] !== undefined && data[field.apiName] !== null && data[field.apiName] !== "");
  if (!uniqueFields.length) return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${objectId}, 0))`;
  for (const field of uniqueFields) {
    const serialized = JSON.stringify(data[field.apiName]);
    const duplicates = excludeRecordId
      ? await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "crm_records"
        WHERE "object_id" = ${objectId}
          AND "data" -> ${field.apiName} = ${serialized}::jsonb
          AND "id" <> ${excludeRecordId}
        LIMIT 1
      `
      : await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "crm_records"
        WHERE "object_id" = ${objectId}
          AND "data" -> ${field.apiName} = ${serialized}::jsonb
        LIMIT 1
      `;
    if (duplicates.length) throw new CrmRecordConstraintError(`${field.label} must be unique.`, 409);
  }
}

function dataForRecord(record: {
  id: string;
  ownerId: string | null;
  createdById: string | null;
  lastModifiedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  data: Prisma.JsonValue;
}): Record<string, unknown> {
  return { ...(record.data as Record<string, unknown>), ...systemFieldValues(record) };
}

function readableRecordData(record: Parameters<typeof dataForRecord>[0], readableFieldNames: Set<string>) {
  return Object.fromEntries(Object.entries(dataForRecord(record)).filter(([apiName]) => readableFieldNames.has(apiName)));
}

export async function GET(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid object." }, { status: 400 });
  const auth = await authorize(params.data.objectId, "canRead");
  if ("response" in auth) return auth.response;
  const object = await getObject(params.data.objectId);
  if (!object || !object.active || !usesRegistryRecords(object)) return NextResponse.json({ error: "Registry-backed object not found or inactive." }, { status: 404 });
  const { searchParams } = new URL(request.url);
  const recordId = searchParams.get("recordId") || undefined;
  const foundRecords = await prisma.crmRecord.findMany({
    where: { objectId: object.id, ...(recordId ? { id: recordId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 1000,
  });
  const records = await filterAccessibleCrmRecords(auth.user, object.id, foundRecords, "read");
  const foundById = new Map(foundRecords.map((record) => [record.id, record]));
  const query = searchParams.get("q")?.trim().toLocaleLowerCase();
  const fieldCapabilities = await getCrmFieldCapabilities(auth.user, object.id, object.fields.map(({ id }) => id));
  const readableFields = object.fields.filter((field) => fieldCapabilities.get(field.id)?.canRead);
  const filtered = records.map((record) => {
    const storedRecord = foundById.get(record.id)!;
    const data = dataForRecord(storedRecord);
    return {
      ...record,
      canManageShares: auth.user.role === "ADMIN" || record.ownerId === auth.user.id,
      data: Object.fromEntries(readableFields.map((field) => [field.apiName, data[field.apiName] ?? null])),
    };
  }).filter((record) => !query || JSON.stringify(record.data).toLocaleLowerCase().includes(query));
  const capabilities = await capabilitiesFor(auth.user, object.id);
  const { lookups, objectIds } = await lookupDataFor(auth.user, object);
  const userIds = [...new Set(filtered.flatMap(({ data }) =>
    [data.CreatedById, data.LastModifiedById, data.OwnerId]
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const canTransferOwner = object.apiName === "Opportunity" && capabilities.canEdit && ["ADMIN", "SALES_MANAGER"].includes(auth.user.role);
  const activeOwners = canTransferOwner
    ? await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];
  const userOptions = users.map(({ id, name }) => ({ id, label: name }));
  const ownerOptionsById = new Map([...users, ...activeOwners].map(({ id, name }) => [id, { id, label: name }]));
  lookups.CreatedById = userOptions;
  lookups.LastModifiedById = userOptions;
  lookups.OwnerId = [...ownerOptionsById.values()];
  const pageLayout = await resolveCrmPageLayout(object.id, auth.user.profileId);
  return NextResponse.json({
    object: {
      id: object.id,
      name: object.name,
      pluralLabel: object.pluralLabel,
      apiName: object.apiName,
      displayFieldApiName: object.displayFieldApiName,
      fields: readableFields.map(({ id, label, apiName, dataType, required, defaultValue, unique, origin, readOnly, isNameField, fieldLength, decimalPlaces, externalId, lookupTargetApiName, picklistValues, relationship }) => ({
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
        canEdit: fieldCapabilities.get(id)?.canEdit ?? false,
        relationship: relationship ? {
          targetObjectId: relationship.targetObjectId,
          targetApiName: relationship.targetObject.apiName,
          targetPluralLabel: relationship.targetObject.pluralLabel,
        } : null,
        picklistValues: picklistValues.map(({ value, label: text }) => ({ value, label: text })),
      })),
    },
    capabilities: { ...capabilities, canTransferOwner },
    pageLayout,
    lookups,
    objectIds,
    timeZone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
    records: filtered,
  });
}

export async function POST(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid object." }, { status: 400 });
  const auth = await authorize(params.data.objectId, "canCreate");
  if ("response" in auth) return auth.response;
  const object = await getObject(params.data.objectId);
  if (!object || !object.active || !usesRegistryRecords(object)) return NextResponse.json({ error: "This object uses its existing business records screen." }, { status: 409 });
  const body = await request.json().catch(() => null);
  const rows: unknown[] = Array.isArray(body?.records) ? body.records : [body?.data ?? body];
  if (!rows.length || rows.length > 500) return NextResponse.json({ error: "Import between 1 and 500 records at a time." }, { status: 400 });
  const fieldCapabilities = await getCrmFieldCapabilities(auth.user, object.id, object.fields.map(({ id }) => id));
  const readableNames = new Set(object.fields.filter((field) => fieldCapabilities.get(field.id)?.canRead).map(({ apiName }) => apiName));
  const editableNames = new Set(object.fields.filter((field) => fieldCapabilities.get(field.id)?.canEdit).map(({ apiName }) => apiName));
  for (const row of rows) {
    const parsed = dataSchema.safeParse(row);
    if (parsed.success) {
      const readOnlyField = immutableFieldName(object, parsed.data);
      if (readOnlyField) return NextResponse.json({ error: `${readOnlyField} is read-only and is generated by the server.` }, { status: 400 });
      const forbiddenField = Object.keys(parsed.data).find((key) => !editableNames.has(key));
      if (forbiddenField) return NextResponse.json({ error: `You do not have edit access to ${forbiddenField}.` }, { status: 403 });
    }
  }
  const validated = await Promise.all(rows.map(async (row: unknown) => {
    const parsed = dataSchema.safeParse(row);
    return parsed.success
      ? validateRecord(object, await withOpportunityAccountDefault(object, withFieldDefaults(object, parsed.data)))
      : { error: "Record data must be an object keyed by field API name." };
  }));
  const firstError = validated.find((row) => "error" in row);
  if (firstError && "error" in firstError) return NextResponse.json({ error: firstError.error }, { status: 400 });
  for (const row of validated) {
    if (!("data" in row) || !row.data) continue;
    const lookupError = await validateLookupValues(auth.user, object, row.data);
    if (lookupError) return NextResponse.json({ error: lookupError.error }, { status: lookupError.status });
  }
  try {
    const records = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const row of validated) {
        const data = await allocateAutoNumbers(tx, object, row.data as Record<string, unknown>);
        await ensureUniqueValues(tx, object.id, data, object.fields);
        created.push(await tx.crmRecord.create({
          data: {
            objectId: object.id,
            ownerId: auth.user.id,
            createdById: auth.user.id,
            lastModifiedById: auth.user.id,
            data: data as object,
          },
        }));
      }
      await tx.crmAuditLog.create({ data: { actorId: auth.user.id, action: rows.length === 1 ? "CUSTOM_RECORD_CREATED" : "CUSTOM_RECORDS_IMPORTED", resourceType: "CrmRecord", resourceId: object.id, details: { count: created.length } } });
      return created;
    });
    return NextResponse.json({ records: records.map((record) => ({ ...record, data: readableRecordData(record, readableNames) })), count: records.length }, { status: 201 });
  } catch (error) {
    if (error instanceof CrmRecordConstraintError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function PUT(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid object." }, { status: 400 });
  const body = await request.json().catch(() => null);
  const id = z.string().min(1).safeParse(body?.id);
  if (!id.success) return NextResponse.json({ error: "Record id is required." }, { status: 400 });
  const auth = await authorize(params.data.objectId, "canEdit");
  if ("response" in auth) return auth.response;
  const object = await getObject(params.data.objectId);
  if (!object || !object.active || !usesRegistryRecords(object)) return NextResponse.json({ error: "This object uses its existing business records screen." }, { status: 409 });
  const existing = await prisma.crmRecord.findFirst({ where: { id: id.data, objectId: object.id } });
  if (!existing) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  if (!(await filterAccessibleCrmRecords(auth.user, object.id, [existing], "edit")).length) {
    return NextResponse.json({ error: "You do not have edit access to this record." }, { status: 403 });
  }
  const submitted = dataSchema.safeParse(body.data);
  if (!submitted.success) return NextResponse.json({ error: "Record data must be an object keyed by field API name." }, { status: 400 });
  const readOnlyField = immutableFieldName(object, submitted.data);
  if (readOnlyField) return NextResponse.json({ error: `${readOnlyField} is read-only and is generated by the server.` }, { status: 400 });
  const mergedData = await withOpportunityAccountDefault(object, { ...(existing.data as Record<string, unknown>), ...submitted.data });
  const validated = validateRecord(object, mergedData);
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const lookupError = await validateLookupValues(auth.user, object, validated.data);
  if (lookupError) return NextResponse.json({ error: lookupError.error }, { status: lookupError.status });
  const fieldCapabilities = await getCrmFieldCapabilities(auth.user, object.id, object.fields.map(({ id: fieldId }) => fieldId));
  const readableNames = new Set(object.fields.filter((field) => fieldCapabilities.get(field.id)?.canRead).map(({ apiName }) => apiName));
  const fieldsByName = new Map(object.fields.map((field) => [field.apiName, field]));
  for (const [key, value] of Object.entries(submitted.data)) {
    const field = fieldsByName.get(key);
    const previousValue = (existing.data as Record<string, unknown>)[key];
    if (JSON.stringify(value) !== JSON.stringify(previousValue) && field && !fieldCapabilities.get(field.id)?.canEdit) {
      return NextResponse.json({ error: `You do not have edit access to ${field.label}.` }, { status: 403 });
    }
  }
  try {
    const record = await prisma.$transaction(async (tx) => {
      await ensureUniqueValues(tx, object.id, validated.data, object.fields, existing.id);
      const updated = await tx.crmRecord.update({
        where: { id: existing.id },
        data: {
          data: { ...(existing.data as object), ...validated.data } as object,
          lastModifiedById: auth.user.id,
        },
      });
      const previousData = existing.data as Record<string, unknown>;
      if (object.apiName === "Opportunity" && previousData.Stage !== "Proposal" && validated.data.Stage === "Proposal") {
        const taskObject = await tx.crmObject.findUnique({ where: { apiName: "Task" }, select: { id: true, fields: { where: { active: true }, select: { apiName: true } } } });
        if (taskObject) {
          const opportunityName = String(validated.data.Name ?? previousData.Name ?? "Opportunity");
          const taskName = `Follow up: ${opportunityName}`;
          const duplicate = await tx.crmRecord.findFirst({
            where: { objectId: taskObject.id, data: { path: ["OpportunityId"], equals: existing.id } },
            select: { id: true },
          });
          if (!duplicate) {
            const taskFields = new Set(taskObject.fields.map((field) => field.apiName));
            const taskData: Record<string, unknown> = {};
            if (taskFields.has("Name")) taskData.Name = taskName;
            if (taskFields.has("DueDate")) taskData.DueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            if (taskFields.has("Status")) taskData.Status = "Not Started";
            if (taskFields.has("OpportunityId")) taskData.OpportunityId = existing.id;
            await tx.crmRecord.create({ data: {
              objectId: taskObject.id,
              ownerId: existing.ownerId ?? auth.user.id,
              createdById: auth.user.id,
              lastModifiedById: auth.user.id,
              data: taskData as object,
            } });
            await tx.crmAuditLog.create({ data: {
              actorId: auth.user.id,
              action: "PROPOSAL_FOLLOW_UP_TASK_CREATED",
              resourceType: "CrmRecord",
              resourceId: existing.id,
              details: { taskName, dueDate: taskData.DueDate ?? null },
            } });
          }
        }
      }
      await tx.crmAuditLog.create({ data: { actorId: auth.user.id, action: "CUSTOM_RECORD_UPDATED", resourceType: "CrmRecord", resourceId: existing.id } });
      return updated;
    });
    return NextResponse.json({ ...record, data: readableRecordData(record, readableNames) });
  } catch (error) {
    if (error instanceof CrmRecordConstraintError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ objectId: string }> }) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid object." }, { status: 400 });
  const auth = await authorize(params.data.objectId, "canDelete");
  if ("response" in auth) return auth.response;
  const object = await getObject(params.data.objectId);
  if (!object || !object.active || !usesRegistryRecords(object)) return NextResponse.json({ error: "This object uses its existing business records screen." }, { status: 409 });
  const ids = z.array(z.string().min(1)).min(1).max(500)
    .refine((values) => new Set(values).size === values.length, "Record ids must be unique.")
    .safeParse((await request.json().catch(() => null))?.ids);
  if (!ids.success) return NextResponse.json({ error: "Select between 1 and 500 record ids." }, { status: 400 });
  const records = await prisma.crmRecord.findMany({
    where: { objectId: object.id, id: { in: ids.data } },
    select: { id: true, ownerId: true, data: true },
  });
  const editableRecords = await filterAccessibleCrmRecords(auth.user, object.id, records, "edit");
  if (editableRecords.length !== ids.data.length) {
    return NextResponse.json({ error: "One or more records are unavailable or not editable." }, { status: 403 });
  }
  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.crmRecord.deleteMany({ where: { objectId: object.id, id: { in: ids.data } } });
    if (deleted.count) await tx.crmAuditLog.create({ data: { actorId: auth.user.id, action: "CUSTOM_RECORDS_DELETED", resourceType: "CrmRecord", resourceId: object.id, details: { count: deleted.count } } });
    return deleted;
  });
  return NextResponse.json({ deleted: result.count });
}
