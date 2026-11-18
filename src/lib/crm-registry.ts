import type { Prisma, PrismaClient } from "@prisma/client";

type SeedField = {
  label: string;
  apiName: string;
  dataType: "ID" | "TEXT" | "TEXT_AREA" | "LONG_TEXT_AREA" | "NUMBER" | "CURRENCY" | "PERCENT" | "DATE" | "DATETIME" | "EMAIL" | "PHONE" | "CHECKBOX" | "PICKLIST" | "AUTO_NUMBER" | "LOOKUP";
  required?: boolean;
  picklistValues?: string[];
  isNameField?: boolean;
  readOnly?: boolean;
  fieldLength?: number;
  lookupTargetApiName?: string;
};

type SeedObject = {
  name: string;
  pluralLabel: string;
  apiName: string;
  module: "SALES" | "SERVICE" | "COMMON";
  icon: string;
  fields: SeedField[];
};

const nameField: SeedField = { label: "Name", apiName: "Name", dataType: "TEXT", required: true, isNameField: true, fieldLength: 80 };
const descriptionField: SeedField = { label: "Description", apiName: "Description", dataType: "TEXT" };
const picklist = (label: string, apiName: string, values: string[], required = false): SeedField => ({ label, apiName, dataType: "PICKLIST", required, picklistValues: values });

export const standardCrmDisplayFields: Record<string, string> = {
  Account: "Name",
  Contact: "Name",
  Lead: "Name",
  Opportunity: "Name",
  Product: "Name",
  PriceBook: "Name",
  PriceBookEntry: "Name",
  Quote: "Name",
  QuoteLineItem: "Description",
  Order: "Name",
  OrderItem: "Description",
  OpportunityLineItem: "Name",
  Task: "Name",
  Event: "Name",
  Case: "CaseNumber",
  CaseComment: "Comment",
  KnowledgeArticle: "Name",
  ServiceContract: "Name",
  WorkOrder: "Name",
  ServiceAppointment: "Name",
};

export const crmSystemFields: SeedField[] = [
  { label: "Record ID", apiName: "Id", dataType: "ID", required: true },
  { label: "Created By", apiName: "CreatedById", dataType: "LOOKUP", required: true, lookupTargetApiName: "User" },
  { label: "Created Date", apiName: "CreatedDate", dataType: "DATETIME", required: true },
  { label: "Last Modified By", apiName: "LastModifiedById", dataType: "LOOKUP", required: true, lookupTargetApiName: "User" },
  { label: "Last Modified Date", apiName: "LastModifiedDate", dataType: "DATETIME", required: true },
  { label: "Owner", apiName: "OwnerId", dataType: "LOOKUP", lookupTargetApiName: "User" },
  { label: "System Modstamp", apiName: "SystemModstamp", dataType: "DATETIME" },
];

export const standardCrmObjects: SeedObject[] = [
  { name: "Account", pluralLabel: "Accounts", apiName: "Account", module: "COMMON", icon: "Building2", fields: [nameField, picklist("Type", "Type", ["BUSINESS", "INDIVIDUAL"], true), { label: "Email", apiName: "Email", dataType: "EMAIL" }, { label: "Phone", apiName: "Phone", dataType: "PHONE" }, { label: "Tax ID", apiName: "TaxId", dataType: "TEXT" }, { label: "Notes", apiName: "Notes", dataType: "TEXT_AREA" }, { label: "Address details", apiName: "AddressDetails", dataType: "TEXT_AREA" }] },
  { name: "Contact", pluralLabel: "Contacts", apiName: "Contact", module: "COMMON", icon: "ContactRound", fields: [
    { label: "Name", apiName: "Name", dataType: "TEXT", required: true, isNameField: true, readOnly: true, fieldLength: 160 },
    { label: "First Name", apiName: "FirstName", dataType: "TEXT", fieldLength: 80 },
    { label: "Last Name", apiName: "LastName", dataType: "TEXT", required: true, fieldLength: 80 },
    { label: "Account ID", apiName: "AccountId", dataType: "LOOKUP", required: true },
    { label: "Title", apiName: "Title", dataType: "TEXT" },
    { label: "Email", apiName: "Email", dataType: "EMAIL" },
    { label: "Phone", apiName: "Phone", dataType: "PHONE" },
    { label: "Primary", apiName: "Primary", dataType: "CHECKBOX" },
  ] },
  { name: "Lead", pluralLabel: "Leads", apiName: "Lead", module: "SALES", icon: "UserRoundSearch", fields: [nameField, { label: "Lead Number", apiName: "Reference", dataType: "AUTO_NUMBER", required: true }, { label: "Email", apiName: "Email", dataType: "EMAIL" }, { label: "Phone", apiName: "Phone", dataType: "PHONE" }, picklist("Status", "Status", ["NEW", "ASSIGNED", "CONTACTED", "QUALIFIED", "NURTURE", "DISQUALIFIED", "CONVERTED"], true), picklist("Source", "Source", ["PHONE", "WALK_IN", "WEBSITE", "REFERRAL", "OTHER"]), { label: "Product interest", apiName: "Interest", dataType: "TEXT" }, { label: "Estimated quantity", apiName: "EstimatedQuantity", dataType: "NUMBER", required: true }, { label: "Next follow-up", apiName: "NextFollowUpAt", dataType: "DATETIME" }, { label: "Notes", apiName: "Notes", dataType: "TEXT_AREA" }, { label: "Activity kind", apiName: "ActivityKind", dataType: "TEXT" }, { label: "Activity note", apiName: "ActivityNote", dataType: "TEXT_AREA" }, { label: "Account ID", apiName: "AccountId", dataType: "LOOKUP" }, { label: "Assignee ID", apiName: "AssigneeId", dataType: "LOOKUP" }] },
  { name: "Opportunity", pluralLabel: "Opportunities", apiName: "Opportunity", module: "SALES", icon: "ChartNoAxesCombined", fields: [nameField, { label: "Account", apiName: "AccountId", dataType: "LOOKUP" }, { label: "Lead", apiName: "LeadId", dataType: "LOOKUP" }, { label: "Amount", apiName: "Amount", dataType: "CURRENCY" }, { label: "Close Date", apiName: "CloseDate", dataType: "DATE" }, picklist("Stage", "Stage", ["Prospecting", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"], true)] },
  { name: "Product", pluralLabel: "Products", apiName: "Product", module: "SALES", icon: "Package", fields: [{ label: "SKU", apiName: "ProductCode", dataType: "TEXT", required: true }, nameField, { label: "Brand", apiName: "Brand", dataType: "TEXT" }, { label: "Model", apiName: "Model", dataType: "TEXT" }, { label: "Manufacturer part", apiName: "ManufacturerPart", dataType: "TEXT" }, { label: "Description", apiName: "Description", dataType: "TEXT_AREA" }, { label: "Price", apiName: "Price", dataType: "CURRENCY", required: true }, picklist("Tracking type", "TrackingType", ["SERIAL", "QUANTITY"]), { label: "Warranty months", apiName: "WarrantyMonths", dataType: "NUMBER" }, { label: "Active", apiName: "Active", dataType: "CHECKBOX" }, { label: "Category ID", apiName: "CategoryId", dataType: "LOOKUP" }] },
  { name: "Price Book", pluralLabel: "Price Books", apiName: "PriceBook", module: "SALES", icon: "BookOpen", fields: [nameField, descriptionField] },
  { name: "Price Book Entry", pluralLabel: "Price Book Entries", apiName: "PriceBookEntry", module: "SALES", icon: "ListPlus", fields: [nameField, { label: "Unit Price", apiName: "UnitPrice", dataType: "CURRENCY", required: true }] },
  { name: "Quote", pluralLabel: "Quotes", apiName: "Quote", module: "SALES", icon: "FileText", fields: [{ label: "Quote number", apiName: "Name", dataType: "AUTO_NUMBER", required: true }, { label: "Account ID", apiName: "AccountId", dataType: "LOOKUP", required: true }, { label: "Lead ID", apiName: "LeadId", dataType: "LOOKUP" }, { label: "Opportunity", apiName: "OpportunityId", dataType: "LOOKUP" }, picklist("Status", "Status", ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]), { label: "Subtotal", apiName: "Subtotal", dataType: "CURRENCY" }, { label: "Discount", apiName: "Discount", dataType: "CURRENCY" }, { label: "Total", apiName: "Total", dataType: "CURRENCY" }, { label: "Valid until", apiName: "ValidUntil", dataType: "DATE" }, { label: "Address snapshot", apiName: "AddressSnapshot", dataType: "TEXT_AREA" }] },
  { name: "Quote Line Item", pluralLabel: "Quote Line Items", apiName: "QuoteLineItem", module: "SALES", icon: "ListPlus", fields: [{ label: "Quote ID", apiName: "QuoteId", dataType: "LOOKUP", required: true }, { label: "Product ID", apiName: "ProductId", dataType: "LOOKUP", required: true }, { label: "SKU", apiName: "SKU", dataType: "TEXT", required: true }, { label: "Description", apiName: "Description", dataType: "TEXT", required: true }, { label: "Quantity", apiName: "Quantity", dataType: "NUMBER", required: true }, { label: "Unit Price", apiName: "UnitPrice", dataType: "CURRENCY", required: true }, { label: "Discount", apiName: "Discount", dataType: "CURRENCY" }] },
  { name: "Order", pluralLabel: "Orders", apiName: "Order", module: "SALES", icon: "ShoppingCart", fields: [{ label: "Order number", apiName: "Name", dataType: "AUTO_NUMBER", required: true }, { label: "Account ID", apiName: "AccountId", dataType: "LOOKUP", required: true }, { label: "Quote ID", apiName: "QuoteId", dataType: "LOOKUP" }, picklist("Status", "Status", ["OPEN", "PARTIALLY_SHIPPED", "SHIPPED", "DELIVERED", "CANCELLED"]), { label: "Invoice reference", apiName: "InvoiceReference", dataType: "TEXT" }, { label: "Subtotal", apiName: "Subtotal", dataType: "CURRENCY" }, { label: "Total", apiName: "Total", dataType: "CURRENCY" }, { label: "Owner ID", apiName: "OwnerId", dataType: "TEXT" }, { label: "Shipping address", apiName: "ShippingAddress", dataType: "TEXT_AREA" }] },
  { name: "Order Item", pluralLabel: "Order Items", apiName: "OrderItem", module: "SALES", icon: "ListPlus", fields: [{ label: "Order ID", apiName: "OrderId", dataType: "LOOKUP", required: true }, { label: "Product ID", apiName: "ProductId", dataType: "LOOKUP", required: true }, { label: "SKU", apiName: "SKU", dataType: "TEXT", required: true }, { label: "Description", apiName: "Description", dataType: "TEXT", required: true }, { label: "Quantity", apiName: "Quantity", dataType: "NUMBER", required: true }, { label: "Unit Price", apiName: "UnitPrice", dataType: "CURRENCY", required: true }] },
  { name: "Opportunity Line Item", pluralLabel: "Opportunity Line Items", apiName: "OpportunityLineItem", module: "SALES", icon: "ListPlus", fields: [nameField, { label: "Quantity", apiName: "Quantity", dataType: "TEXT" }, { label: "Unit Price", apiName: "UnitPrice", dataType: "CURRENCY" }] },
  { name: "Task", pluralLabel: "Tasks", apiName: "Task", module: "COMMON", icon: "CheckSquare", fields: [nameField, { label: "Due Date", apiName: "DueDate", dataType: "DATE" }, picklist("Status", "Status", ["Not Started", "In Progress", "Completed"]), { label: "Opportunity", apiName: "OpportunityId", dataType: "LOOKUP" }] },
  { name: "Event", pluralLabel: "Events", apiName: "Event", module: "COMMON", icon: "CalendarDays", fields: [nameField, { label: "Start Date", apiName: "StartDate", dataType: "DATE" }] },
  { name: "Case", pluralLabel: "Cases", apiName: "Case", module: "SERVICE", icon: "Headset", fields: [{ label: "Case number", apiName: "CaseNumber", dataType: "AUTO_NUMBER", required: true }, { label: "Account ID", apiName: "AccountId", dataType: "LOOKUP", required: true }, { label: "Order ID", apiName: "OrderId", dataType: "LOOKUP" }, { label: "Purchased unit ID", apiName: "UnitId", dataType: "LOOKUP" }, { label: "Subject", apiName: "Subject", dataType: "TEXT", required: true }, { label: "Description", apiName: "Description", dataType: "TEXT_AREA", required: true }, picklist("Type", "Type", ["TECHNICAL", "DELIVERY", "WARRANTY", "REPAIR", "REPLACEMENT"]), picklist("Priority", "Priority", ["LOW", "NORMAL", "HIGH", "URGENT"]), picklist("Status", "Status", ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]), { label: "Waiting reason", apiName: "WaitingReason", dataType: "TEXT" }, { label: "Diagnosis", apiName: "Diagnosis", dataType: "TEXT_AREA" }, { label: "Parts used", apiName: "PartsUsedNotes", dataType: "TEXT_AREA" }, { label: "Warranty decision", apiName: "WarrantyDecision", dataType: "TEXT" }, { label: "Chargeable", apiName: "Chargeable", dataType: "CHECKBOX" }, { label: "Customer approved", apiName: "CustomerApproved", dataType: "CHECKBOX" }, { label: "Resolution", apiName: "ResolutionNote", dataType: "TEXT_AREA" }, { label: "Handover notes", apiName: "HandoverNotes", dataType: "TEXT_AREA" }, { label: "Assignee ID", apiName: "AssigneeId", dataType: "LOOKUP" }] },
  { name: "Case Comment", pluralLabel: "Case Comments", apiName: "CaseComment", module: "SERVICE", icon: "MessageSquare", fields: [{ label: "Case ID", apiName: "CaseId", dataType: "LOOKUP", required: true }, { label: "Author ID", apiName: "AuthorId", dataType: "TEXT", required: true }, { label: "Type", apiName: "Type", dataType: "TEXT", required: true }, { label: "Comment", apiName: "Comment", dataType: "TEXT_AREA", required: true }, { label: "Created", apiName: "CreatedAt", dataType: "DATETIME" }] },
  { name: "Knowledge Article", pluralLabel: "Knowledge Articles", apiName: "KnowledgeArticle", module: "SERVICE", icon: "BookOpenText", fields: [nameField, descriptionField, { label: "Status", apiName: "Status", dataType: "PICKLIST" }] },
  { name: "Service Contract", pluralLabel: "Service Contracts", apiName: "ServiceContract", module: "SERVICE", icon: "FileBadge", fields: [nameField, { label: "Start Date", apiName: "StartDate", dataType: "DATE" }, { label: "End Date", apiName: "EndDate", dataType: "DATE" }] },
  { name: "Work Order", pluralLabel: "Work Orders", apiName: "WorkOrder", module: "SERVICE", icon: "Wrench", fields: [nameField, { label: "Status", apiName: "Status", dataType: "PICKLIST" }] },
  { name: "Service Appointment", pluralLabel: "Service Appointments", apiName: "ServiceAppointment", module: "SERVICE", icon: "CalendarClock", fields: [nameField, { label: "Scheduled Start", apiName: "ScheduledStart", dataType: "DATETIME" }] },
];

const STANDARD_FIELD_SYNC_VERSION = "native-fields-v9-sales-lookup-links";
function standardFieldProtected(objectApiName: string, fieldApiName: string) {
  if (objectApiName === "Opportunity" && ["AccountId", "LeadId"].includes(fieldApiName)) return false;
  if (["Quote", "Task"].includes(objectApiName) && fieldApiName === "OpportunityId") return false;
  return true;
}
const retiredNativeFields: Record<string, string[]> = {
  Quote: ["QuoteNumber"],
  Order: ["OrderNumber"],
  QuoteLineItem: ["Name"],
  OrderItem: ["Name"],
  Case: ["Name", "Title"],
  CaseComment: ["Name"],
};
const retiredNativePicklistValues: Record<string, Record<string, string[]>> = {
  Case: { Type: ["SUPPORT", "OTHER"] },
};

export async function syncStandardCrmFields(db: PrismaClient) {
  const settingKey = "crm.standardFieldSyncVersion";
  let added = 0;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${settingKey}, 0))`;
    const current = await tx.businessSetting.findUnique({ where: { key: settingKey }, select: { value: true } });
    if (current?.value === STANDARD_FIELD_SYNC_VERSION) return;
    const profiles = await tx.crmProfile.findMany({ select: { id: true } });
    for (const definition of standardCrmObjects) {
      const object = await tx.crmObject.findUnique({ where: { apiName: definition.apiName }, select: { id: true } });
      if (!object) continue;
      const existingFields = await tx.crmField.findMany({ where: { objectId: object.id }, select: { id: true, apiName: true, position: true, dataType: true } });
      const fieldsByName = new Map(existingFields.map((field) => [field.apiName, field]));
      const objectPermissions = await tx.crmProfileObjectPermission.findMany({
        where: { objectId: object.id },
        select: { profileId: true, canEdit: true },
      });
      const canEditByProfile = new Map(objectPermissions.map(({ profileId, canEdit }) => [profileId, canEdit]));
      let nextPosition = existingFields.reduce((max, field) => Math.max(max, field.position), -1) + 1;
      const fieldOrder = [...existingFields].sort((a, b) => a.position - b.position).map((field) => field.id);
      const fieldDefinitions: (SeedField & { origin: "SYSTEM" | "STANDARD"; readOnly: boolean })[] = [
        ...definition.fields.map((field) => ({ ...field, origin: "STANDARD" as const, readOnly: field.readOnly || field.dataType === "AUTO_NUMBER" })),
        ...crmSystemFields.map((field) => ({ ...field, origin: "SYSTEM" as const, readOnly: true })),
      ];
      for (const field of fieldDefinitions) {
        let existing = fieldsByName.get(field.apiName);
        if (!existing) {
          existing = await tx.crmField.create({
            data: {
              objectId: object.id,
              label: field.label,
              apiName: field.apiName,
              dataType: field.dataType,
              required: Boolean(field.required),
              origin: field.origin,
              readOnly: field.readOnly || field.dataType === "AUTO_NUMBER",
              isNameField: standardCrmDisplayFields[definition.apiName] === field.apiName,
              fieldLength: "fieldLength" in field ? field.fieldLength ?? null : null,
              lookupTargetApiName: "lookupTargetApiName" in field ? field.lookupTargetApiName : null,
              protected: standardFieldProtected(definition.apiName, field.apiName),
              position: nextPosition++,
            },
            select: { id: true, apiName: true, position: true, dataType: true },
          });
          fieldsByName.set(existing.apiName, existing);
          fieldOrder.push(existing.id);
          added++;
        } else {
          await tx.crmField.update({
            where: { id: existing.id },
            data: {
              label: field.label,
              dataType: field.dataType,
              required: Boolean(field.required),
              origin: field.origin,
              readOnly: field.readOnly || field.dataType === "AUTO_NUMBER",
              isNameField: standardCrmDisplayFields[definition.apiName] === field.apiName,
              fieldLength: "fieldLength" in field ? field.fieldLength ?? null : null,
              lookupTargetApiName: "lookupTargetApiName" in field ? field.lookupTargetApiName : null,
              protected: standardFieldProtected(definition.apiName, field.apiName),
            },
          });
        }
        await tx.crmProfileFieldPermission.createMany({
          data: profiles.map((profile) => ({
            profileId: profile.id,
            fieldId: existing.id,
            visible: true,
            editable: field.origin === "SYSTEM" ? false : Boolean(canEditByProfile.get(profile.id)) && !field.readOnly,
          })),
          skipDuplicates: true,
        });
        for (const [position, value] of (field.picklistValues || []).entries()) {
          await tx.crmPicklistValue.upsert({
            where: { fieldId_value: { fieldId: existing.id, value } },
            update: {},
            create: { fieldId: existing.id, value, label: value.replaceAll("_", " "), position },
          });
        }
        const retiredValues = retiredNativePicklistValues[definition.apiName]?.[field.apiName];
        if (retiredValues?.length) {
          await tx.crmPicklistValue.updateMany({ where: { fieldId: existing.id, value: { in: retiredValues } }, data: { active: false } });
        }
      }
      for (const apiName of retiredNativeFields[definition.apiName] || []) {
        const obsolete = fieldsByName.get(apiName);
        if (obsolete) await tx.crmField.update({ where: { id: obsolete.id }, data: { active: false } });
      }
      await tx.crmObject.update({ where: { id: object.id }, data: { displayFieldApiName: standardCrmDisplayFields[definition.apiName] } });
      await mergeFieldsIntoLayouts(tx, object.id, fieldOrder);
    }
    const customObjects = await tx.crmObject.findMany({
      where: { objectType: "CUSTOM" },
      select: { id: true, displayFieldApiName: true },
    });
    for (const object of customObjects) {
      const existingFields = await tx.crmField.findMany({
        where: { objectId: object.id },
        select: { id: true, apiName: true, position: true, dataType: true },
      });
      const fieldsByName = new Map(existingFields.map((field) => [field.apiName, field]));
      let nextPosition = existingFields.reduce((max, field) => Math.max(max, field.position), -1) + 1;
      const fieldOrder = [...existingFields].sort((a, b) => a.position - b.position).map((field) => field.id);
      const nameField = fieldsByName.get("Name");
      if (nameField) {
        await tx.crmField.update({
          where: { id: nameField.id },
          data: {
            label: "Name",
            origin: "STANDARD",
            protected: true,
            isNameField: true,
            readOnly: nameField.dataType === "AUTO_NUMBER",
            fieldLength: nameField.dataType === "TEXT" ? 80 : null,
          },
        });
        await tx.crmProfileFieldPermission.createMany({
          data: profiles.map((profile) => ({
            profileId: profile.id,
            fieldId: nameField.id,
            visible: true,
            editable: nameField.dataType !== "AUTO_NUMBER",
          })),
          skipDuplicates: true,
        });
      }
      for (const field of crmSystemFields) {
        const existing = fieldsByName.get(field.apiName);
        const systemField = existing
          ? await tx.crmField.update({
            where: { id: existing.id },
            data: {
              label: field.label,
              dataType: field.dataType,
              required: Boolean(field.required),
              origin: "SYSTEM",
              readOnly: true,
              lookupTargetApiName: field.lookupTargetApiName ?? null,
              protected: true,
            },
          })
          : await tx.crmField.create({
            data: {
              objectId: object.id,
              label: field.label,
              apiName: field.apiName,
              dataType: field.dataType,
              required: Boolean(field.required),
              origin: "SYSTEM",
              readOnly: true,
              lookupTargetApiName: field.lookupTargetApiName ?? null,
              protected: true,
              position: nextPosition++,
            },
          });
        if (!existing) fieldOrder.push(systemField.id);
        await tx.crmProfileFieldPermission.createMany({
          data: profiles.map((profile) => ({
            profileId: profile.id,
            fieldId: systemField.id,
            visible: true,
            editable: false,
          })),
          skipDuplicates: true,
        });
      }
      await tx.crmObject.update({
        where: { id: object.id },
        data: { displayFieldApiName: object.displayFieldApiName ?? "Name" },
      });
      await mergeFieldsIntoLayouts(tx, object.id, fieldOrder);
    }
    for (const [sourceApiName, targetApiName, label, relationshipType] of standardCrmRelationships) {
      if (relationshipType !== "LOOKUP") continue;
      const [source, target] = await Promise.all([
        tx.crmObject.findUnique({ where: { apiName: sourceApiName }, select: { id: true } }),
        tx.crmObject.findUnique({ where: { apiName: targetApiName }, select: { id: true } }),
      ]);
      if (!source || !target) continue;
      const field = await tx.crmField.findFirst({
        where: { objectId: source.id, apiName: `${label.replace(/[^A-Za-z0-9]/g, "")}Id`, dataType: "LOOKUP", active: true },
        select: { id: true },
      });
      if (!field) continue;
      const relationship = await tx.crmRelationship.findFirst({ where: { sourceObjectId: source.id, targetObjectId: target.id, label } });
      if (!relationship) await tx.crmRelationship.create({ data: { sourceObjectId: source.id, targetObjectId: target.id, label, relationshipType, fieldId: field.id } });
      else if (!relationship.fieldId) await tx.crmRelationship.update({ where: { id: relationship.id }, data: { fieldId: field.id } });
    }
    await tx.businessSetting.upsert({
      where: { key: settingKey },
      update: { value: STANDARD_FIELD_SYNC_VERSION },
      create: { key: settingKey, value: STANDARD_FIELD_SYNC_VERSION },
    });
  }, { timeout: 600_000 });
  return added;
}

async function mergeFieldsIntoLayouts(db: PrismaClient | Prisma.TransactionClient, objectId: string, activeFieldOrder: string[]) {
  const activeFields = new Set(activeFieldOrder);
  const layouts = await db.crmPageLayout.findMany({ where: { objectId }, select: { id: true, fieldOrder: true, hiddenFieldIds: true, sections: true } });
  for (const layout of layouts) {
    const fieldOrder = [...layout.fieldOrder.filter((id) => activeFields.has(id))];
    const present = new Set(fieldOrder);
    const added = activeFieldOrder.filter((id) => !present.has(id));
    fieldOrder.push(...added);
    const sections = Array.isArray(layout.sections) ? layout.sections as { id?: unknown; label?: unknown; fieldIds?: unknown; columns?: unknown }[] : [];
    const normalizedSections = sections.map((section) => {
      const base = { id: typeof section.id === "string" ? section.id : "main", label: typeof section.label === "string" ? section.label : "Details" };
      if (Array.isArray(section.columns)) return { ...base, columns: section.columns.map((value, index) => {
        const column = typeof value === "object" && value !== null ? value as { id?: unknown; fieldIds?: unknown } : {};
        return { id: typeof column.id === "string" ? column.id : `column-${index + 1}`, fieldIds: Array.isArray(column.fieldIds) ? column.fieldIds.filter((id): id is string => typeof id === "string" && activeFields.has(id)) : [] };
      }) };
      return { ...base, fieldIds: Array.isArray(section.fieldIds) ? section.fieldIds.filter((id): id is string => typeof id === "string" && activeFields.has(id)) : [] };
    });
    if (added.length) {
      if (normalizedSections.length) {
        const first = normalizedSections[0];
        if ("columns" in first) first.columns[0]?.fieldIds.push(...added);
        else first.fieldIds.push(...added);
      }
      else normalizedSections.push({ id: "main", label: "Details", fieldIds: fieldOrder });
    }
    await db.crmPageLayout.update({
      where: { id: layout.id },
      data: { fieldOrder, hiddenFieldIds: layout.hiddenFieldIds.filter((id) => activeFields.has(id)), sections: normalizedSections },
    });
  }
}

export const standardCrmRelationships = [
  ["Account", "Contact", "Contacts", "ONE_TO_MANY"],
  ["Account", "Opportunity", "Opportunities", "ONE_TO_MANY"],
  ["Account", "Case", "Cases", "ONE_TO_MANY"],
  ["Account", "Order", "Orders", "ONE_TO_MANY"],
  ["Contact", "Case", "Cases", "ONE_TO_MANY"],
  ["Lead", "Opportunity", "Converted Opportunities", "ONE_TO_MANY"],
  ["Opportunity", "Quote", "Quotes", "ONE_TO_MANY"],
  ["Quote", "QuoteLineItem", "Quote Line Items", "ONE_TO_MANY"],
  ["PriceBook", "PriceBookEntry", "Price Book Entries", "ONE_TO_MANY"],
  ["Product", "PriceBookEntry", "Price Book Entries", "ONE_TO_MANY"],
  ["Order", "OrderItem", "Order Items", "ONE_TO_MANY"],
  ["Case", "CaseComment", "Case Comments", "ONE_TO_MANY"],
  ["Case", "WorkOrder", "Work Orders", "ONE_TO_MANY"],
  ["WorkOrder", "ServiceAppointment", "Service Appointments", "ONE_TO_MANY"],
  ["Opportunity", "OpportunityLineItem", "Opportunity Products", "ONE_TO_MANY"],
  ["Task", "Opportunity", "Opportunity", "LOOKUP"],
  ["Opportunity", "Account", "Account", "LOOKUP"],
  ["Opportunity", "Lead", "Lead", "LOOKUP"],
  ["Quote", "Opportunity", "Opportunity", "LOOKUP"],
] as const;

export const standardCrmApps = [
  { key: "sales", name: "Sales Workspace", icon: "BriefcaseBusiness", objects: ["Account", "Contact", "Lead", "Opportunity", "Product", "PriceBook", "Quote", "QuoteLineItem", "Order", "OrderItem", "Task", "Event"], landing: "Lead" },
  { key: "service", name: "Service Workspace", icon: "Headset", objects: ["Account", "Contact", "Case", "CaseComment", "KnowledgeArticle", "ServiceContract", "WorkOrder", "ServiceAppointment", "Task", "Event"], landing: "Case" },
];
const defaultRoles = [
  ["ADMIN", "Administrator"],
  ["SALES_MANAGER", "Sales Manager"],
  ["SALES_EXECUTIVE", "Sales Executive"],
  ["DISPATCH", "Dispatch"],
  ["SERVICE_MANAGER", "Service Manager"],
  ["SERVICE_AGENT", "Service Agent"],
  ["TECHNICIAN", "Technician"],
] as const;
const defaultProfiles = [
  ["system-administrator", "System Administrator", "Full administrative access to CRM objects, fields, and applications.", "ADMIN"],
  ["sales-manager", "Sales Manager", "Sales object and application access.", "SALES_MANAGER"],
  ["sales-user", "Sales User", "Standard sales user access.", "SALES_EXECUTIVE"],
  ["service-manager", "Service Manager", "Service object and application access.", "SERVICE_MANAGER"],
  ["service-user", "Service User", "Standard service agent access.", "SERVICE_AGENT"],
  ["technician", "Technician", "Technician access to service records.", "TECHNICIAN"],
  ["dispatch", "Dispatch", "Dispatch access to sales orders and accounts.", "DISPATCH"],
] as const;

export async function seedCrmRegistry(db: PrismaClient) {
  const ids = new Map<string, string>();
  for (const definition of standardCrmObjects) {
    const object = await db.crmObject.upsert({
      where: { apiName: definition.apiName },
      update: {},
      create: {
        ...definition,
        objectType: "STANDARD",
        protected: true,
        fields: { create: definition.fields.map(({ picklistValues, ...field }, position) => ({
          ...field,
          protected: true,
          position,
          ...(picklistValues ? { picklistValues: { create: picklistValues.map((value, valuePosition) => ({ value, label: value.replaceAll("_", " "), position: valuePosition })) } } : {}),
        })) },
      },
    });
    ids.set(definition.apiName, object.id);
    await db.crmSharingConfig.upsert({
      where: { objectId: object.id },
      update: {},
      create: { objectId: object.id },
    });
    const fields = await db.crmField.findMany({ where: { objectId: object.id }, orderBy: { position: "asc" }, select: { id: true } });
    const existingLayout = await db.crmPageLayout.findFirst({ where: { objectId: object.id, isDefault: true } });
    if (!existingLayout) await db.crmPageLayout.create({
      data: { objectId: object.id, name: `${definition.name} Layout`, isDefault: true, fieldOrder: fields.map((field) => field.id) },
    });
  }
  await syncStandardCrmFields(db);

  for (const [sourceKey, targetKey, label, relationshipType] of standardCrmRelationships) {
    const sourceObjectId = ids.get(sourceKey);
    const targetObjectId = ids.get(targetKey);
    if (!sourceObjectId || !targetObjectId) continue;
    const existing = await db.crmRelationship.findFirst({ where: { sourceObjectId, targetObjectId, label } });
    if (relationshipType === "LOOKUP") {
      const field = await db.crmField.findFirst({ where: { objectId: sourceObjectId, apiName: `${label.replace(/[^A-Za-z0-9]/g, "")}Id`, dataType: "LOOKUP" } });
      if (!field) continue;
      if (!existing) await db.crmRelationship.create({ data: { sourceObjectId, targetObjectId, label, relationshipType, fieldId: field.id } });
      else if (!existing.fieldId) await db.crmRelationship.update({ where: { id: existing.id }, data: { fieldId: field.id } });
    } else if (!existing) {
      await db.crmRelationship.create({ data: { sourceObjectId, targetObjectId, label, relationshipType } });
    }
  }

  for (const appDefinition of standardCrmApps) {
    const app = await db.crmApp.upsert({
      where: { key: appDefinition.key },
      update: {},
      create: {
        key: appDefinition.key,
        name: appDefinition.name,
        icon: appDefinition.icon,
        isDefault: true,
        defaultObjectId: ids.get(appDefinition.landing),
      },
    });
    for (const [navigationOrder, apiName] of appDefinition.objects.entries()) {
      const objectId = ids.get(apiName);
      if (!objectId) continue;
      await db.crmAppAssignment.upsert({
        where: { appId_objectId: { appId: app.id, objectId } },
        update: {},
        create: { appId: app.id, objectId, navigationOrder },
      });
    }
  }

  for (const [key, name] of defaultRoles) {
    await db.crmRole.upsert({ where: { key }, update: {}, create: { key, name, builtIn: true } });
  }

  const crmRoles = await db.crmRole.findMany({ select: { id: true, key: true } });
  const roleByKey = new Map(crmRoles.map((role) => [role.key, role.id]));
  const appAccess: Record<string, string[]> = {
    sales: ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE", "DISPATCH"],
    service: ["ADMIN", "SERVICE_MANAGER", "SERVICE_AGENT", "TECHNICIAN"],
  };
  for (const app of await db.crmApp.findMany({ select: { id: true, key: true } })) {
    for (const [roleKey, roleId] of roleByKey) {
      await db.crmAppPermission.upsert({
        where: { appId_roleId: { appId: app.id, roleId } },
        update: {},
        create: { appId: app.id, roleId, canAccess: appAccess[app.key]?.includes(roleKey) ?? roleKey === "ADMIN" },
      });
    }
  }
  const crmObjects = await db.crmObject.findMany({ select: { id: true, module: true, apiName: true } });
  for (const role of crmRoles) {
    for (const object of crmObjects) {
      const shared = ["Account", "Contact", "Task", "Event"].includes(object.apiName);
      const sales = object.module === "SALES";
      const service = object.module === "SERVICE";
      const canRead = role.key === "ADMIN" ||
        (role.key === "DISPATCH" && ["Account", "Order"].includes(object.apiName)) ||
        (role.key.startsWith("SALES_") && (sales || shared)) ||
        (role.key === "SERVICE_MANAGER" && (service || shared)) ||
        (role.key === "SERVICE_AGENT" && (service || shared)) ||
        (role.key === "TECHNICIAN" && (service || shared));
      const canEdit = role.key === "ADMIN" ||
        (role.key === "DISPATCH" && object.apiName === "Order") ||
        (role.key === "SALES_MANAGER" && (sales || shared)) ||
        (role.key === "SALES_EXECUTIVE" && (sales || shared)) ||
        (role.key === "SERVICE_MANAGER" && (service || shared)) ||
        (role.key === "SERVICE_AGENT" && service) ||
        (role.key === "TECHNICIAN" && service);
      await db.crmObjectPermission.upsert({
        where: { roleId_objectId: { roleId: role.id, objectId: object.id } },
        update: {},
        create: {
          roleId: role.id,
          objectId: object.id,
          canRead,
          canCreate: canEdit,
          canEdit,
          canDelete: role.key === "ADMIN",
        },
      });
    }
  }

  const profileIds = new Map<string, string>();
  for (const [key, name, description] of defaultProfiles) {
    const profile = await db.crmProfile.upsert({
      where: { key },
      update: {},
      create: { key, name, description, builtIn: true },
      select: { id: true },
    });
    profileIds.set(key, profile.id);
  }
  const [legacyObjectPermissions, legacyFieldPermissions, legacyAppPermissions] = await Promise.all([
    db.crmObjectPermission.findMany(),
    db.crmFieldPermission.findMany(),
    db.crmAppPermission.findMany(),
  ]);
  const objectPermissionByRole = new Map(legacyObjectPermissions.map((permission) => [`${permission.roleId}:${permission.objectId}`, permission]));
  const fieldPermissionByRole = new Map(legacyFieldPermissions.map((permission) => [`${permission.roleId}:${permission.fieldId}`, permission]));
  const appPermissionByRole = new Map(legacyAppPermissions.map((permission) => [`${permission.roleId}:${permission.appId}`, permission]));
  const objectsWithFields = await db.crmObject.findMany({
    include: { fields: { select: { id: true, dataType: true } } },
  });
  const appsWithAssignments = await db.crmApp.findMany({
    include: { assignments: { select: { objectId: true } } },
  });
  const existingProfileObjectPermissions = await db.crmProfileObjectPermission.findMany({
    where: { profileId: { in: [...profileIds.values()] } },
  });
  const profileObjectPermissionByKey = new Map<string, { canRead: boolean; canEdit: boolean }>(existingProfileObjectPermissions.map((permission) => [
    `${permission.profileId}:${permission.objectId}`,
    { canRead: permission.canRead, canEdit: permission.canEdit },
  ] as const));
  const existingProfileObjectPermissionKeys = new Set(existingProfileObjectPermissions.map((permission) => `${permission.profileId}:${permission.objectId}`));
  for (const [profileKey, , , roleKey] of defaultProfiles) {
    const profileId = profileIds.get(profileKey);
    const roleId = roleByKey.get(roleKey);
    if (!profileId) continue;
    const role = crmRoles.find((item) => item.key === roleKey);
    const objectPermissionRows: Array<{
      profileId: string; objectId: string; canCreate: boolean; canRead: boolean;
      canEdit: boolean; canDelete: boolean; viewAll: boolean; modifyAll: boolean;
    }> = [];
    const fieldPermissionRows: Array<{ profileId: string; fieldId: string; visible: boolean; editable: boolean }> = [];
    const appPermissionRows: Array<{ profileId: string; appId: string; canAccess: boolean }> = [];
    const tabPermissionRows: Array<{ profileId: string; appId: string; objectId: string; visibility: string }> = [];
    for (const object of objectsWithFields) {
      const legacyPermission = role
        ? objectPermissionByRole.get(`${role.id}:${object.id}`)
        : null;
      const shared = ["Account", "Contact", "Task", "Event"].includes(object.apiName);
      const isAdmin = profileKey === "system-administrator";
      const isSales = profileKey === "sales-manager" || profileKey === "sales-user";
      const isService = ["service-manager", "service-user", "technician"].includes(profileKey);
      const defaultRead = isAdmin || (isSales && (object.module === "SALES" || shared)) ||
        (isService && (object.module === "SERVICE" || shared)) ||
        (profileKey === "dispatch" && ["Account", "Order"].includes(object.apiName));
      const defaultEdit = isAdmin ||
        (isSales && (object.module === "SALES" || shared)) ||
        (profileKey === "service-manager" && (object.module === "SERVICE" || shared)) ||
        (["service-user", "technician"].includes(profileKey) && object.module === "SERVICE") ||
        (profileKey === "dispatch" && object.apiName === "Order");
      const objectPermissionKey = `${profileId}:${object.id}`;
      const defaultObjectPermission = {
          profileId,
          objectId: object.id,
          canCreate: legacyPermission?.canCreate ?? defaultEdit,
          canRead: legacyPermission?.canRead ?? defaultRead,
          canEdit: legacyPermission?.canEdit ?? defaultEdit,
          canDelete: legacyPermission?.canDelete ?? isAdmin,
          viewAll: isAdmin,
          modifyAll: isAdmin,
        };
      const objectPermission = profileObjectPermissionByKey.get(objectPermissionKey) ?? defaultObjectPermission;
      profileObjectPermissionByKey.set(objectPermissionKey, { canRead: objectPermission.canRead, canEdit: objectPermission.canEdit });
      if (!existingProfileObjectPermissionKeys.has(objectPermissionKey)) {
        objectPermissionRows.push(defaultObjectPermission);
      }
      for (const field of object.fields) {
        const legacyFieldPermission = roleId
          ? fieldPermissionByRole.get(`${roleId}:${field.id}`)
          : null;
        const visible = isAdmin || (legacyFieldPermission?.canRead ?? true);
        fieldPermissionRows.push({
            profileId,
            fieldId: field.id,
            visible,
            editable: visible && (isAdmin || (legacyFieldPermission?.canEdit ?? objectPermission.canEdit)) && field.dataType !== "AUTO_NUMBER",
        });
      }
    }

    for (const app of appsWithAssignments) {
      const legacyAccess = role
        ? appPermissionByRole.get(`${role.id}:${app.id}`)
        : null;
      const canAccess = legacyAccess?.canAccess ?? (
        profileKey === "system-administrator" ||
        (["sales-manager", "sales-user", "dispatch"].includes(profileKey) && app.key === "sales") ||
        (["service-manager", "service-user", "technician"].includes(profileKey) && app.key === "service")
      );
      appPermissionRows.push({ profileId, appId: app.id, canAccess });
      for (const objectId of app.assignments.map(({ objectId }) => objectId)) {
        const objectPermission = profileObjectPermissionByKey.get(`${profileId}:${objectId}`);
        tabPermissionRows.push({
            profileId,
            appId: app.id,
            objectId,
            visibility: canAccess && objectPermission?.canRead ? "DEFAULT_ON" : "HIDDEN",
        });
      }
    }
    await Promise.all([
      db.crmProfileObjectPermission.createMany({ data: objectPermissionRows, skipDuplicates: true }),
      db.crmProfileFieldPermission.createMany({ data: fieldPermissionRows, skipDuplicates: true }),
      db.crmProfileAppPermission.createMany({ data: appPermissionRows, skipDuplicates: true }),
      db.crmProfileTabPermission.createMany({ data: tabPermissionRows, skipDuplicates: true }),
    ]);
  }

  return ids.size;
}

export async function standardRecordCount(db: PrismaClient, apiName: string) {
  switch (apiName) {
    case "Account": return db.customer.count();
    case "Contact": return db.contact.count();
    case "Lead": return db.lead.count();
    case "Product": return db.product.count();
    case "Quote": return db.quote.count();
    case "QuoteLineItem": return db.quoteItem.count();
    case "Order": return db.order.count();
    case "OrderItem": return db.orderItem.count();
    case "Case": return db.serviceTicket.count();
    case "CaseComment": return db.ticketUpdate.count();
    default: return 0;
  }
}

export const standardObjectsWithExistingData = [
  "Account", "Contact", "Lead", "Product", "Quote", "QuoteLineItem",
  "Order", "OrderItem", "Case", "CaseComment",
] as const;

export function hasStandardRecordStore(apiName: string) {
  return standardObjectsWithExistingData.includes(apiName as typeof standardObjectsWithExistingData[number]);
}
