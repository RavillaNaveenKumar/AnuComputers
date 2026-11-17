import type { RoleName } from "@/lib/permissions";
import { customerAccessWhere } from "@/lib/data-access";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { filterAccessibleCrmRecords } from "@/lib/crm-record-access";
import { hasStandardRecordStore } from "@/lib/crm-registry";
import type { RecordOperation } from "@/lib/crm-record-access";

export type NativeCrmUser = { id: string; role: RoleName };
export type NativeCrmRow = {
  id: string;
  ownerId: string | null;
  createdById: string | null;
  lastModifiedById: string | null;
  legacyAccess: boolean;
  createdAt: Date;
  updatedAt: Date;
  data: Record<string, unknown>;
};
export type NativeCrmLookupOption = { id: string; label: string };

function row(
  id: string,
  createdAt: Date,
  updatedAt: Date,
  data: Record<string, unknown>,
  ownerId: string | null = null,
  legacyAccess = true,
): NativeCrmRow {
  return {
    id,
    ownerId,
    createdById: null,
    lastModifiedById: null,
    legacyAccess,
    createdAt,
    updatedAt,
    data: {
      Id: id,
      CreatedById: null,
      CreatedDate: createdAt.toISOString(),
      LastModifiedById: null,
      LastModifiedDate: updatedAt.toISOString(),
      OwnerId: ownerId,
      SystemModstamp: updatedAt.toISOString(),
      ...data,
    },
  };
}

function recordWhere(recordId?: string, recordIds?: string[]) {
  if (recordIds) return { id: { in: recordIds } };
  return recordId ? { id: recordId } : {};
}

async function loadNativeCrmRecordsRaw(
  apiName: string,
  user: NativeCrmUser,
  take = 1000,
  recordId?: string,
  recordIds?: string[],
): Promise<NativeCrmRow[]> {
  switch (apiName) {
    case "Account": {
      const records = await prisma.customer.findMany({
        where: recordWhere(recordId, recordIds),
        include: { leads: { select: { assigneeId: true } }, quotes: { select: { createdById: true } } },
        orderBy: { updatedAt: "desc" },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.updatedAt, {
        Name: record.name,
        Type: record.kind,
        Email: record.email,
        Phone: record.phone,
        TaxId: record.taxId,
        Notes: record.notes,
      }, record.ownerId, user.role !== "SALES_EXECUTIVE" || record.ownerId === user.id ||
        record.leads.some(({ assigneeId }) => assigneeId === user.id) ||
        record.quotes.some(({ createdById }) => createdById === user.id)));
    }
    case "Contact": {
      const records = await prisma.contact.findMany({
        where: recordWhere(recordId, recordIds),
        include: { customer: { select: { ownerId: true, leads: { select: { assigneeId: true } }, quotes: { select: { createdById: true } } } } },
        orderBy: { createdAt: "desc" },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.updatedAt, {
        Name: record.name,
        FirstName: record.firstName,
        LastName: record.lastName,
        AccountId: record.customerId,
        Title: record.title,
        Email: record.email,
        Phone: record.phone,
        Primary: record.primary,
      }, record.customer.ownerId, user.role !== "SALES_EXECUTIVE" || record.customer.ownerId === user.id ||
        record.customer.leads.some(({ assigneeId }) => assigneeId === user.id) ||
        record.customer.quotes.some(({ createdById }) => createdById === user.id)));
    }
    case "Lead": {
      const records = await prisma.lead.findMany({
        where: recordWhere(recordId, recordIds),
        orderBy: { updatedAt: "desc" },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.updatedAt, {
        Name: record.name,
        Reference: record.reference,
        Email: record.email,
        Phone: record.phone,
        Status: record.status,
        Source: record.source,
        Interest: record.interest,
        EstimatedQuantity: record.estimatedQuantity,
        NextFollowUpAt: record.nextFollowUpAt,
        Notes: record.notes,
        AccountId: record.customerId,
        AssigneeId: record.assigneeId,
      }, record.assigneeId, user.role !== "SALES_EXECUTIVE" || record.assigneeId === user.id));
    }
    case "Product": {
      const records = await prisma.product.findMany({
        where: recordWhere(recordId, recordIds),
        orderBy: { updatedAt: "desc" },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.updatedAt, {
        ProductCode: record.sku,
        Name: record.name,
        Brand: record.brand,
        Model: record.model,
        ManufacturerPart: record.manufacturerPart,
        Description: record.description,
        Price: Number(record.unitPrice),
        TrackingType: record.trackingType,
        WarrantyMonths: record.warrantyMonths,
        Active: record.active,
        CategoryId: record.categoryId,
      }));
    }
    case "Quote": {
      const records = await prisma.quote.findMany({
        where: recordWhere(recordId, recordIds),
        orderBy: { createdAt: "desc" },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.updatedAt, {
        Name: record.reference,
        CreatedById: record.createdById,
        AccountId: record.customerId,
        LeadId: record.leadId,
        Status: record.status,
        Subtotal: Number(record.subtotal),
        Discount: Number(record.discount),
        Total: Number(record.total),
        ValidUntil: record.validUntil,
      }, record.createdById, user.role !== "SALES_EXECUTIVE" || record.createdById === user.id));
    }
    case "QuoteLineItem": {
      const records = await prisma.quoteItem.findMany({
        where: recordWhere(recordId, recordIds),
        include: { quote: { select: { createdAt: true, createdById: true } } },
        orderBy: { quote: { createdAt: "desc" } },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.updatedAt, {
        QuoteId: record.quoteId,
        ProductId: record.productId,
        SKU: record.skuSnapshot,
        Description: record.description,
        Quantity: record.quantity,
        UnitPrice: Number(record.unitPrice),
        Discount: Number(record.discount),
      }, record.quote.createdById, user.role !== "SALES_EXECUTIVE" || record.quote.createdById === user.id));
    }
    case "Order": {
      const records = await prisma.order.findMany({
        where: recordWhere(recordId, recordIds),
        orderBy: { createdAt: "desc" },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.updatedAt, {
        Name: record.reference,
        AccountId: record.customerId,
        QuoteId: record.quoteId,
        Status: record.status,
        InvoiceReference: record.invoiceReference,
        Subtotal: Number(record.subtotal),
        Total: Number(record.total),
        OwnerId: record.ownerId,
      }, record.ownerId, user.role !== "SALES_EXECUTIVE" || record.ownerId === user.id));
    }
    case "OrderItem": {
      const records = await prisma.orderItem.findMany({
        where: recordWhere(recordId, recordIds),
        include: { order: { select: { createdAt: true, ownerId: true } } },
        orderBy: { order: { createdAt: "desc" } },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.updatedAt, {
        OrderId: record.orderId,
        ProductId: record.productId,
        SKU: record.skuSnapshot,
        Description: record.description,
        Quantity: record.quantity,
        UnitPrice: Number(record.unitPrice),
      }, record.order.ownerId, user.role !== "SALES_EXECUTIVE" || record.order.ownerId === user.id));
    }
    case "Case": {
      const records = await prisma.serviceTicket.findMany({
        where: recordWhere(recordId, recordIds),
        orderBy: { createdAt: "desc" },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.updatedAt, {
        CaseNumber: record.reference,
        AccountId: record.customerId,
        OrderId: record.orderId,
        UnitId: record.unitId,
        Subject: record.title,
        Description: record.description,
        Type: record.type,
        Priority: record.priority,
        Status: record.status,
        WaitingReason: record.waitingReason,
        Diagnosis: record.diagnosis,
        PartsUsedNotes: record.partsUsedNotes,
        WarrantyDecision: record.warrantyDecision,
        Chargeable: record.chargeable,
        CustomerApproved: record.customerApproved,
        ResolutionNote: record.resolutionNote,
        HandoverNotes: record.handoverNotes,
        AssigneeId: record.assigneeId,
      }, record.assigneeId, user.role !== "TECHNICIAN" || record.assigneeId === user.id));
    }
    case "CaseComment": {
      const records = await prisma.ticketUpdate.findMany({
        where: recordWhere(recordId, recordIds),
        include: { ticket: { select: { assigneeId: true } } },
        orderBy: { createdAt: "desc" },
        take,
      });
      return records.map((record) => row(record.id, record.createdAt, record.createdAt, {
        CaseId: record.ticketId,
        CreatedById: record.authorId,
        AuthorId: record.authorId,
        Type: record.kind,
        Comment: record.note,
        CreatedAt: record.createdAt,
      }, record.ticket.assigneeId, user.role !== "TECHNICIAN" || record.ticket.assigneeId === user.id));
    }
    default:
      throw new Error(`No native CRM record adapter exists for ${apiName}.`);
  }
}

export async function listNativeCrmRecords(
  apiName: string,
  user: NativeCrmUser,
  take = 1000,
  recordId?: string,
  operation: RecordOperation = "read",
): Promise<NativeCrmRow[]> {
  const rawRecords = await loadNativeCrmRecordsRaw(apiName, user, take, recordId);
  const metadata = rawRecords.length
    ? await prisma.crmNativeRecordMetadata.findMany({
      where: { objectApiName: apiName, recordId: { in: rawRecords.map(({ id }) => id) } },
      select: { recordId: true, createdById: true, lastModifiedById: true, lastModifiedAt: true },
    })
    : [];
  const metadataById = new Map(metadata.map((entry) => [entry.recordId, entry]));
  const records = rawRecords.map((record) => {
    const audit = metadataById.get(record.id);
    const dataCreator = record.data.CreatedById;
    const createdById = audit?.createdById ?? (typeof dataCreator === "string" ? dataCreator : null);
    const lastModifiedById = audit?.lastModifiedById ?? null;
    const updatedAt = audit?.lastModifiedAt ?? record.updatedAt;
    return {
      ...record,
      createdById,
      lastModifiedById,
      updatedAt,
      data: {
        ...record.data,
        CreatedById: createdById,
        LastModifiedById: lastModifiedById,
        CreatedDate: record.createdAt.toISOString(),
        LastModifiedDate: updatedAt.toISOString(),
        SystemModstamp: updatedAt.toISOString(),
        OwnerId: record.ownerId,
      },
    };
  });
  if (!records.length) return [];
  const object = await prisma.crmObject.findFirst({
    where: { apiName, active: true },
    select: { id: true },
  });
  if (!object) return [];

  const loadParents = async (objectId: string, recordIds: string[]) => {
    const parentObject = await prisma.crmObject.findFirst({
      where: { id: objectId, active: true },
      select: { apiName: true },
    });
    if (parentObject && hasStandardRecordStore(parentObject.apiName)) {
      const parentRecords = await loadNativeCrmRecordsRaw(parentObject.apiName, user, recordIds.length, undefined, recordIds);
      return {
        records: parentRecords.map((record) => ({ ...record, data: record.data as Prisma.JsonValue })),
        native: true,
      };
    }
    return {
      records: await prisma.crmRecord.findMany({
        where: { objectId, id: { in: recordIds } },
        select: { id: true, ownerId: true, data: true },
      }),
      native: false,
    };
  };
  const accessible = await filterAccessibleCrmRecords(
    user,
    object.id,
    records.map((record) => ({ ...record, data: record.data as Prisma.JsonValue })),
    operation,
    new Set(),
    { storage: "native", loadNativeParents: loadParents },
  );
  return accessible as NativeCrmRow[];
}

export async function nativeCrmLookupOptions(apiName: string, user: NativeCrmUser): Promise<Record<string, NativeCrmLookupOption[]>> {
  const [accounts, leads, quotes, orders, products, categories, units, staff, cases] = await Promise.all([
    ["Account", "Contact", "Lead", "Quote", "Order", "Case"].includes(apiName)
      ? listNativeCrmRecords("Account", user, 500)
      : Promise.resolve([]),
    apiName === "Quote"
      ? listNativeCrmRecords("Lead", user, 500)
      : Promise.resolve([]),
    apiName === "QuoteLineItem"
      ? listNativeCrmRecords("Quote", user, 500)
      : Promise.resolve([]),
    ["OrderItem", "Case"].includes(apiName)
      ? listNativeCrmRecords("Order", user, 500)
      : Promise.resolve([]),
    ["Quote", "Order", "QuoteLineItem", "OrderItem"].includes(apiName)
      ? listNativeCrmRecords("Product", user, 500)
      : Promise.resolve([]),
    apiName === "Product"
      ? prisma.productCategory.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 })
      : Promise.resolve([]),
    apiName === "Case"
      ? prisma.purchasedUnit.findMany({ where: { customer: customerAccessWhere(user) }, select: { id: true, serial: true, product: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 500 })
      : Promise.resolve([]),
    ["Lead", "Case"].includes(apiName)
      ? prisma.user.findMany({ where: { active: true, role: { in: apiName === "Lead" ? ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE"] : ["ADMIN", "SERVICE_AGENT", "TECHNICIAN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 })
      : Promise.resolve([]),
    apiName === "CaseComment"
      ? listNativeCrmRecords("Case", user, 500)
      : Promise.resolve([]),
  ]);
  const result: Record<string, NativeCrmLookupOption[]> = {};
  if (accounts.length) result.AccountId = accounts.map(({ id, data }) => ({ id, label: String(data.Name ?? id) }));
  if (leads.length) result.LeadId = leads
    .filter(({ data }) => data.Status !== "CONVERTED" && data.Status !== "DISQUALIFIED")
    .map(({ id, data }) => ({ id, label: `${String(data.Reference ?? "")} · ${String(data.Name ?? id)}` }));
  if (quotes.length) result.QuoteId = quotes
    .filter(({ data }) => data.Status === "DRAFT")
    .map(({ id, data }) => ({ id, label: String(data.Name ?? id) }));
  if (orders.length) result.OrderId = orders.map(({ id, data }) => ({ id, label: String(data.Name ?? id) }));
  if (products.length) result.ProductId = products
    .filter(({ data }) => data.Active === true)
    .map(({ id, data }) => ({ id, label: `${String(data.ProductCode ?? "")} · ${String(data.Name ?? id)}` }));
  if (categories.length) result.CategoryId = categories.map(({ id, name }) => ({ id, label: name }));
  if (units.length) result.UnitId = units.map(({ id, serial, product }) => ({ id, label: `${serial} · ${product.name}` }));
  if (staff.length) result.AssigneeId = staff.map(({ id, name }) => ({ id, label: name }));
  if (cases.length) result.CaseId = cases.map(({ id, data }) => ({ id, label: `${String(data.CaseNumber ?? "")} · ${String(data.Subject ?? id)}` }));
  return result;
}

export function nativeRecordToJson(record: NativeCrmRow) {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    data: Object.fromEntries(Object.entries(record.data).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ])),
  };
}

export async function getNativeCrmRecord(
  apiName: string,
  recordId: string,
  user: NativeCrmUser,
  operation: RecordOperation = "read",
) {
  const [record] = await listNativeCrmRecords(apiName, user, 1, recordId, operation);
  return record ?? null;
}

export async function listNativeCrmRecordIds(
  apiName: string,
  user: NativeCrmUser,
  operation: RecordOperation = "read",
  take = 10000,
) {
  const records = await listNativeCrmRecords(apiName, user, take, undefined, operation);
  return records.map(({ id }) => id);
}
