import type { Prisma } from "@prisma/client";
import { calculateQuote } from "@/lib/business";
import { allocateCrmAutoNumber } from "@/lib/crm-auto-number";
import { prisma } from "@/lib/prisma";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { can, type RoleName } from "@/lib/permissions";
import { reference } from "@/lib/references";

export class NativeCrmRecordError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type NativeCrmMutationUser = { id: string; role: RoleName };
export type NativeCrmFieldValueInput = { fieldId: string; value: Prisma.InputJsonValue };

function valueString(data: Record<string, unknown>, key: string, required = false) {
  const value = data[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new NativeCrmRecordError(`${key} is required.`, 400);
  return null;
}

function valueNumber(data: Record<string, unknown>, key: string, fallback = 0) {
  const value = data[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new NativeCrmRecordError(`${key} must be a valid number.`, 400);
  return value;
}

function valueBoolean(data: Record<string, unknown>, key: string, fallback = false) {
  const value = data[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "boolean") throw new NativeCrmRecordError(`${key} must be true or false.`, 400);
  return value;
}

function valueDate(data: Record<string, unknown>, key: string) {
  const value = data[key];
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new NativeCrmRecordError(`${key} must be a valid date.`, 400);
  return date;
}

function valueItems(data: Record<string, unknown>) {
  const items = data.Items;
  if (!Array.isArray(items) || !items.length) throw new NativeCrmRecordError("Add at least one line item.", 400);
  return items.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new NativeCrmRecordError(`Line item ${index + 1} is invalid.`, 400);
    const line = item as Record<string, unknown>;
    const productId = valueString(line, "ProductId", true)!;
    const quantity = valueNumber(line, "Quantity");
    const unitPrice = valueNumber(line, "UnitPrice");
    const discount = valueNumber(line, "Discount");
    if (!Number.isInteger(quantity) || quantity < 1 || unitPrice < 0 || discount < 0) {
      throw new NativeCrmRecordError(`Line item ${index + 1} has an invalid quantity, price, or discount.`, 400);
    }
    return { productId, quantity, unitPrice, discount, description: valueString(line, "Description") };
  });
}

async function writeFieldValues(tx: Prisma.TransactionClient, apiName: string, recordId: string, values: NativeCrmFieldValueInput[]) {
  for (const value of values) {
    await tx.crmNativeFieldValue.upsert({
      where: { objectApiName_recordId_fieldId: { objectApiName: apiName, recordId, fieldId: value.fieldId } },
      update: { value: value.value },
      create: { objectApiName: apiName, recordId, fieldId: value.fieldId, value: value.value },
    });
  }
}

async function ensureUniqueNativeFieldValues(
  tx: Prisma.TransactionClient,
  apiName: string,
  recordId: string,
  values: NativeCrmFieldValueInput[],
) {
  const fieldIds = values.map(({ fieldId }) => fieldId);
  if (!fieldIds.length) return;
  const uniqueFields = await tx.crmField.findMany({
    where: { id: { in: fieldIds }, unique: true, origin: "CUSTOM" },
    select: { id: true, label: true },
  });
  if (!uniqueFields.length) return;
  const uniqueIds = new Set(uniqueFields.map(({ id }) => id));
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${apiName}, 0))`;
  for (const value of values) {
    if (!uniqueIds.has(value.fieldId) || value.value === null || value.value === "") continue;
    const duplicates = await tx.$queryRaw<{ recordId: string }[]>`
      SELECT "record_id" AS "recordId"
      FROM "crm_native_field_values"
      WHERE "object_api_name" = ${apiName}
        AND "field_id" = ${value.fieldId}
        AND "record_id" <> ${recordId}
        AND "value" = ${JSON.stringify(value.value)}::jsonb
      LIMIT 1
    `;
    if (duplicates.length) {
      const field = uniqueFields.find(({ id }) => id === value.fieldId)!;
      throw new NativeCrmRecordError(`${field.label} must be unique.`, 409);
    }
  }
}

async function withGeneratedAutoNumbers(
  tx: Prisma.TransactionClient,
  apiName: string,
  values: NativeCrmFieldValueInput[],
) {
  const object = await tx.crmObject.findUnique({ where: { apiName }, select: { id: true } });
  if (!object) return values;
  const fields = await tx.crmField.findMany({
    where: { objectId: object.id, active: true, origin: "CUSTOM", dataType: "AUTO_NUMBER" },
    select: { id: true, autoNumberPrefix: true, autoNumberSuffix: true, autoNumberStart: true, autoNumberDigits: true },
  });
  const existingIds = new Set(values.map(({ fieldId }) => fieldId));
  const generated = await Promise.all(fields
    .filter((field) => !existingIds.has(field.id))
    .map(async (field) => ({ fieldId: field.id, value: await allocateCrmAutoNumber(tx, field) })));
  return [...values, ...generated];
}

async function writeAudit(tx: Prisma.TransactionClient, userId: string, action: string, apiName: string, recordId: string) {
  await tx.crmAuditLog.create({ data: { actorId: userId, action, resourceType: apiName, resourceId: recordId } });
}

export async function writeNativeRecordMetadata(
  tx: Prisma.TransactionClient,
  apiName: string,
  recordId: string,
  userId: string,
  created = false,
) {
  await tx.crmNativeRecordMetadata.upsert({
    where: { objectApiName_recordId: { objectApiName: apiName, recordId } },
    update: { lastModifiedById: userId },
    create: {
      objectApiName: apiName,
      recordId,
      createdById: created ? userId : null,
      lastModifiedById: userId,
    },
  });
}

export async function deleteNativeRecordMetadata(tx: Prisma.TransactionClient, apiName: string, recordId: string) {
  await tx.crmNativeRecordMetadata.deleteMany({ where: { objectApiName: apiName, recordId } });
}

async function requireAccount(
  tx: Prisma.TransactionClient,
  id: string,
  user: NativeCrmMutationUser,
  validatedAccountIds: ReadonlySet<string> = new Set(),
) {
  const accessible = validatedAccountIds.has(id) || await getNativeCrmRecord("Account", id, user);
  const account = accessible ? await tx.customer.findUnique({ where: { id }, select: { id: true } }) : null;
  if (!account) throw new NativeCrmRecordError("Select an account you can access.", 400);
  return account;
}

async function requireProducts(tx: Prisma.TransactionClient, items: ReturnType<typeof valueItems>) {
  const products = await tx.product.findMany({ where: { id: { in: items.map(({ productId }) => productId) }, active: true } });
  const map = new Map(products.map((product) => [product.id, product]));
  if (map.size !== new Set(items.map(({ productId }) => productId)).size) throw new NativeCrmRecordError("One or more products are unavailable.", 400);
  return map;
}

function ensureLeadTransition(current: string, next: string) {
  const transitions: Record<string, string[]> = {
    NEW: ["ASSIGNED", "CONTACTED", "NURTURE", "DISQUALIFIED"],
    ASSIGNED: ["CONTACTED", "QUALIFIED", "NURTURE", "DISQUALIFIED"],
    CONTACTED: ["QUALIFIED", "NURTURE", "DISQUALIFIED"],
    QUALIFIED: ["NURTURE", "DISQUALIFIED"],
    NURTURE: ["CONTACTED", "QUALIFIED", "DISQUALIFIED"],
    DISQUALIFIED: [],
    CONVERTED: [],
  };
  if (next === "CONVERTED" || (next !== current && !transitions[current]?.includes(next))) {
    throw new NativeCrmRecordError("Use the lead conversion workflow or choose a valid status transition.", 409);
  }
}

function ensureCaseTransition(current: string, next: string) {
  const transitions: Record<string, string[]> = {
    NEW: ["ASSIGNED"],
    ASSIGNED: ["IN_PROGRESS", "WAITING"],
    IN_PROGRESS: ["WAITING", "RESOLVED"],
    WAITING: ["IN_PROGRESS", "RESOLVED"],
    RESOLVED: ["IN_PROGRESS", "CLOSED"],
    CLOSED: [],
  };
  if (next !== current && !transitions[current]?.includes(next)) {
    throw new NativeCrmRecordError("Choose a valid case status transition.", 409);
  }
}

async function updateQuoteTotals(tx: Prisma.TransactionClient, quoteId: string) {
  const [quote, items] = await Promise.all([
    tx.quote.findUnique({ where: { id: quoteId }, select: { discount: true } }),
    tx.quoteItem.findMany({ where: { quoteId }, select: { quantity: true, unitPrice: true, discount: true } }),
  ]);
  if (!quote || !items.length) throw new NativeCrmRecordError("A quote must retain at least one line item.", 409);
  const totals = calculateQuote(items.map((item) => ({
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    discount: Number(item.discount),
  })), Number(quote.discount));
  await tx.quote.update({ where: { id: quoteId }, data: totals });
}

async function updateOrderTotals(tx: Prisma.TransactionClient, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { quantity: true, unitPrice: true } });
  if (!items.length) throw new NativeCrmRecordError("An order must retain at least one line item.", 409);
  const total = items.reduce((sum, item) => sum + item.quantity * Number(item.unitPrice), 0);
  await tx.order.update({ where: { id: orderId }, data: { subtotal: total, total } });
}

export async function createNativeCrmRecord(
  apiName: string,
  data: Record<string, unknown>,
  user: NativeCrmMutationUser,
  fieldValues: NativeCrmFieldValueInput[] = [],
  transaction?: Prisma.TransactionClient,
  childFieldValues: NativeCrmFieldValueInput[][] = [],
  validatedAccountIds: ReadonlySet<string> = new Set(),
) {
  const create = async (tx: Prisma.TransactionClient) => {
    let id: string;
    switch (apiName) {
      case "Account": {
        const record = await tx.customer.create({ data: {
          name: valueString(data, "Name", true)!,
          kind: valueString(data, "Type") || "BUSINESS",
          ownerId: user.id,
          email: valueString(data, "Email"),
          phone: valueString(data, "Phone"),
          taxId: valueString(data, "TaxId"),
          notes: valueString(data, "Notes"),
        } });
        id = record.id;
        break;
      }
      case "Contact": {
        const account = await requireAccount(tx, valueString(data, "AccountId", true)!, user, validatedAccountIds);
        const primary = valueBoolean(data, "Primary");
        const firstName = valueString(data, "FirstName");
        const lastName = valueString(data, "LastName") || valueString(data, "Name", true)!;
        if (primary) {
          const demoted = await tx.contact.findMany({ where: { customerId: account.id, primary: true }, select: { id: true } });
          await tx.contact.updateMany({ where: { id: { in: demoted.map(({ id }) => id) } }, data: { primary: false } });
          for (const contact of demoted) await writeNativeRecordMetadata(tx, "Contact", contact.id, user.id);
        }
        const record = await tx.contact.create({ data: {
          customerId: account.id,
          name: [firstName, lastName].filter(Boolean).join(" "),
          firstName,
          lastName,
          email: valueString(data, "Email"),
          phone: valueString(data, "Phone"),
          title: valueString(data, "Title"),
          primary,
        } });
        id = record.id;
        break;
      }
      case "Lead": {
        const accountId = valueString(data, "AccountId");
        if (accountId) await requireAccount(tx, accountId, user, validatedAccountIds);
        const requestedStatus = valueString(data, "Status");
        if (requestedStatus && !["NEW", "ASSIGNED"].includes(requestedStatus)) {
          throw new NativeCrmRecordError("New leads must start as New or Assigned. Use the conversion workflow for later states.", 409);
        }
        const requestedAssignee = valueString(data, "AssigneeId");
        const assigneeId = can(user.role, "leads:assign") ? requestedAssignee || user.id : user.id;
        if (requestedAssignee && !can(user.role, "leads:assign") && requestedAssignee !== user.id) {
          throw new NativeCrmRecordError("You cannot assign leads to another staff member.", 403);
        }
        const record = await tx.lead.create({ data: {
          reference: reference("LEAD"),
          name: valueString(data, "Name", true)!,
          email: valueString(data, "Email"),
          phone: valueString(data, "Phone"),
          source: valueString(data, "Source") || "OTHER",
          interest: valueString(data, "Interest"),
          estimatedQuantity: valueNumber(data, "EstimatedQuantity", 1),
          notes: valueString(data, "Notes"),
          status: (requestedStatus as "NEW" | "ASSIGNED" | undefined) || (requestedAssignee ? "ASSIGNED" : "NEW"),
          nextFollowUpAt: valueDate(data, "NextFollowUpAt"),
          assigneeId,
          customerId: accountId,
          activities: { create: { authorId: user.id, kind: "CREATED", note: "Lead created" } },
        } });
        id = record.id;
        break;
      }
      case "Product": {
        const categoryId = valueString(data, "CategoryId");
        if (categoryId && !await tx.productCategory.findUnique({ where: { id: categoryId }, select: { id: true } })) {
          throw new NativeCrmRecordError("Product category not found.", 400);
        }
        const record = await tx.product.create({ data: {
          sku: valueString(data, "ProductCode", true)!,
          name: valueString(data, "Name", true)!,
          description: valueString(data, "Description"),
          brand: valueString(data, "Brand"),
          model: valueString(data, "Model"),
          manufacturerPart: valueString(data, "ManufacturerPart"),
          unitPrice: valueNumber(data, "Price"),
          trackingType: valueString(data, "TrackingType") as "SERIAL" | "QUANTITY" || "QUANTITY",
          warrantyMonths: valueNumber(data, "WarrantyMonths"),
          active: valueBoolean(data, "Active", true),
          categoryId,
        } });
        id = record.id;
        break;
      }
      case "Quote": {
        const account = await requireAccount(tx, valueString(data, "AccountId", true)!, user, validatedAccountIds);
        const lines = valueItems(data);
        const products = await requireProducts(tx, lines);
        const discount = valueNumber(data, "Discount");
        const totals = calculateQuote(lines.map(({ quantity, unitPrice, discount: lineDiscount }) => ({ quantity, unitPrice, discount: lineDiscount })), discount);
        const leadId = valueString(data, "LeadId");
        if (leadId) {
          const accessibleLead = await getNativeCrmRecord("Lead", leadId, user);
          const lead = await tx.lead.findFirst({
            where: { id: leadId, status: { in: ["QUALIFIED", "CONVERTED"] }, customerId: account.id },
            select: { id: true },
          });
          if (!accessibleLead || !lead) throw new NativeCrmRecordError("Choose a qualified lead associated with this account.", 400);
        }
        const record = await tx.quote.create({ data: {
          reference: reference("QUO"),
          customerId: account.id,
          leadId,
          createdById: user.id,
          discount,
          validUntil: valueDate(data, "ValidUntil"),
          ...totals,
          items: { create: lines.map((line) => {
            const product = products.get(line.productId)!;
            return { productId: product.id, skuSnapshot: product.sku, description: line.description || product.name, quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount };
          }) },
        }, include: { items: { select: { id: true } } } });
        for (const [index, item] of record.items.entries()) {
          const itemValues = await withGeneratedAutoNumbers(tx, "QuoteLineItem", childFieldValues[index] ?? []);
          await ensureUniqueNativeFieldValues(tx, "QuoteLineItem", item.id, itemValues);
          await writeFieldValues(tx, "QuoteLineItem", item.id, itemValues);
          await writeNativeRecordMetadata(tx, "QuoteLineItem", item.id, user.id, true);
        }
        id = record.id;
        break;
      }
      case "QuoteLineItem": {
        const quoteId = valueString(data, "QuoteId", true)!;
        const accessibleQuote = await getNativeCrmRecord("Quote", quoteId, user, "edit");
        const quote = await tx.quote.findFirst({
          where: { id: quoteId, status: "DRAFT" },
          select: { id: true },
        });
        if (!accessibleQuote || !quote) throw new NativeCrmRecordError("Select an accessible draft quote.", 404);
        const product = await tx.product.findFirst({ where: { id: valueString(data, "ProductId", true)!, active: true } });
        if (!product) throw new NativeCrmRecordError("Select an active product.", 400);
        const record = await tx.quoteItem.create({ data: {
          quoteId,
          productId: product.id,
          skuSnapshot: product.sku,
          description: valueString(data, "Description") || product.name,
          quantity: valueNumber(data, "Quantity"),
          unitPrice: valueNumber(data, "UnitPrice"),
          discount: valueNumber(data, "Discount"),
        } });
        await updateQuoteTotals(tx, quoteId);
        await writeNativeRecordMetadata(tx, "Quote", quoteId, user.id);
        id = record.id;
        break;
      }
      case "Order": {
        const account = await requireAccount(tx, valueString(data, "AccountId", true)!, user, validatedAccountIds);
        if (valueString(data, "QuoteId")) throw new NativeCrmRecordError("Create an order from its accepted quote to preserve the quote relationship.", 409);
        const lines = valueItems(data);
        const products = await requireProducts(tx, lines);
        const totals = calculateQuote(lines.map(({ quantity, unitPrice }) => ({ quantity, unitPrice, discount: 0 })), 0);
        const record = await tx.order.create({ data: {
          reference: reference("ORD"),
          customerId: account.id,
          ownerId: user.id,
          invoiceReference: valueString(data, "InvoiceReference"),
          ...totals,
          items: { create: lines.map((line) => {
            const product = products.get(line.productId)!;
            return { productId: product.id, skuSnapshot: product.sku, description: line.description || product.name, quantity: line.quantity, unitPrice: line.unitPrice };
          }) },
        }, include: { items: { select: { id: true } } } });
        for (const [index, item] of record.items.entries()) {
          const itemValues = await withGeneratedAutoNumbers(tx, "OrderItem", childFieldValues[index] ?? []);
          await ensureUniqueNativeFieldValues(tx, "OrderItem", item.id, itemValues);
          await writeFieldValues(tx, "OrderItem", item.id, itemValues);
          await writeNativeRecordMetadata(tx, "OrderItem", item.id, user.id, true);
        }
        id = record.id;
        break;
      }
      case "OrderItem": {
        const orderId = valueString(data, "OrderId", true)!;
        const accessibleOrder = await getNativeCrmRecord("Order", orderId, user, "edit");
        const order = await tx.order.findFirst({
          where: { id: orderId, status: "OPEN" },
          select: { id: true },
        });
        if (!accessibleOrder || !order) throw new NativeCrmRecordError("Select an accessible open order.", 404);
        const product = await tx.product.findFirst({ where: { id: valueString(data, "ProductId", true)!, active: true } });
        if (!product) throw new NativeCrmRecordError("Select an active product.", 400);
        const record = await tx.orderItem.create({ data: {
          orderId,
          productId: product.id,
          skuSnapshot: product.sku,
          description: valueString(data, "Description") || product.name,
          quantity: valueNumber(data, "Quantity"),
          unitPrice: valueNumber(data, "UnitPrice"),
        } });
        if (!Number.isInteger(record.quantity) || record.quantity < 1 || Number(record.unitPrice) < 0) {
          throw new NativeCrmRecordError("Order item quantity and unit price are invalid.", 400);
        }
        await updateOrderTotals(tx, orderId);
        await writeNativeRecordMetadata(tx, "Order", orderId, user.id);
        id = record.id;
        break;
      }
      case "Case": {
        const account = await requireAccount(tx, valueString(data, "AccountId", true)!, user, validatedAccountIds);
        const orderId = valueString(data, "OrderId");
        const unitId = valueString(data, "UnitId");
        const accessibleOrder = orderId ? await getNativeCrmRecord("Order", orderId, user) : null;
        const [order, unit] = await Promise.all([
          orderId && accessibleOrder ? tx.order.findFirst({ where: { id: orderId, customerId: account.id }, select: { id: true } }) : Promise.resolve(null),
          unitId ? tx.purchasedUnit.findFirst({ where: { id: unitId, customerId: account.id }, select: { id: true, orderItem: { select: { orderId: true } } } }) : Promise.resolve(null),
        ]);
        if ((orderId && !order) || (unitId && !unit) || (order && unit?.orderItem && unit.orderItem.orderId !== order.id)) {
          throw new NativeCrmRecordError("The case account, order, and purchased unit must be related.", 400);
        }
        const assigneeId = valueString(data, "AssigneeId");
        if (assigneeId && !can(user.role, "service:assign")) throw new NativeCrmRecordError("You cannot assign cases.", 403);
        if (assigneeId) {
          const assignee = await tx.user.findFirst({ where: { id: assigneeId, active: true, role: { in: ["SERVICE_AGENT", "TECHNICIAN"] } }, select: { id: true } });
          if (!assignee) throw new NativeCrmRecordError("Choose an active service agent or technician.", 400);
        }
        const record = await tx.serviceTicket.create({ data: {
          reference: reference("TKT"),
          customerId: account.id,
          orderId,
          unitId,
          type: valueString(data, "Type") || "TECHNICAL",
          title: valueString(data, "Subject") || valueString(data, "Title", true)!,
          description: valueString(data, "Description", true)!,
          priority: valueString(data, "Priority") as "LOW" | "NORMAL" | "HIGH" | "URGENT" || "NORMAL",
          assigneeId,
          updates: { create: { authorId: user.id, kind: "CREATED", note: "Case opened" } },
        }, include: { updates: { select: { id: true } } } });
        for (const comment of record.updates) await writeNativeRecordMetadata(tx, "CaseComment", comment.id, user.id, true);
        id = record.id;
        break;
      }
      case "CaseComment": {
        const caseId = valueString(data, "CaseId", true)!;
        const accessibleCase = await getNativeCrmRecord("Case", caseId, user);
        const ticket = await tx.serviceTicket.findFirst({
          where: { id: caseId },
          select: { id: true },
        });
        if (!accessibleCase || !ticket) throw new NativeCrmRecordError("Case not found or unavailable.", 404);
        const record = await tx.ticketUpdate.create({ data: {
          ticketId: ticket.id,
          authorId: user.id,
          kind: valueString(data, "Type") || "COMMENT",
          note: valueString(data, "Comment", true)!,
        } });
        id = record.id;
        break;
      }
      default:
        throw new NativeCrmRecordError(`No native CRM record adapter exists for ${apiName}.`, 404);
    }
    const values = await withGeneratedAutoNumbers(tx, apiName, fieldValues);
    await ensureUniqueNativeFieldValues(tx, apiName, id, values);
    await writeFieldValues(tx, apiName, id, values);
    await writeNativeRecordMetadata(tx, apiName, id, user.id, true);
    await writeAudit(tx, user.id, `${apiName.toUpperCase()}_CREATED`, apiName, id);
    return id;
  };
  return transaction ? create(transaction) : prisma.$transaction(create);
}

export async function updateNativeCrmRecord(
  apiName: string,
  id: string,
  data: Record<string, unknown>,
  user: NativeCrmMutationUser,
  fieldValues: NativeCrmFieldValueInput[] = [],
) {
  await prisma.$transaction(async (tx) => {
    switch (apiName) {
      case "Account": {
        await tx.customer.update({ where: { id }, data: {
          ...(data.Name !== undefined ? { name: valueString(data, "Name", true)! } : {}),
          ...(data.Type !== undefined ? { kind: valueString(data, "Type", true)! } : {}),
          ...(data.Email !== undefined ? { email: valueString(data, "Email") } : {}),
          ...(data.Phone !== undefined ? { phone: valueString(data, "Phone") } : {}),
          ...(data.TaxId !== undefined ? { taxId: valueString(data, "TaxId") } : {}),
          ...(data.Notes !== undefined ? { notes: valueString(data, "Notes") } : {}),
        } });
        break;
      }
      case "Contact": {
        const existing = await tx.contact.findUnique({ where: { id }, select: { id: true, customerId: true, name: true, firstName: true, lastName: true } });
        if (!existing) throw new NativeCrmRecordError("Contact not found.", 404);
        const customerId = valueString(data, "AccountId") || existing.customerId;
        await requireAccount(tx, customerId, user);
        const primary = data.Primary === undefined ? undefined : valueBoolean(data, "Primary");
        const firstName = data.FirstName === undefined ? existing.firstName : valueString(data, "FirstName");
        const lastName = data.LastName === undefined ? existing.lastName || existing.name : valueString(data, "LastName", true);
        const name = data.FirstName === undefined && data.LastName === undefined
          ? undefined
          : [firstName, lastName].filter(Boolean).join(" ");
        if (primary) {
          const demoted = await tx.contact.findMany({ where: { customerId, primary: true, id: { not: id } }, select: { id: true } });
          await tx.contact.updateMany({ where: { id: { in: demoted.map(({ id: contactId }) => contactId) } }, data: { primary: false } });
          for (const contact of demoted) await writeNativeRecordMetadata(tx, "Contact", contact.id, user.id);
        }
        await tx.contact.update({ where: { id }, data: {
          ...(name !== undefined ? { name, firstName, lastName } : {}),
          customerId,
          ...(data.Title !== undefined ? { title: valueString(data, "Title") } : {}),
          ...(data.Email !== undefined ? { email: valueString(data, "Email") } : {}),
          ...(data.Phone !== undefined ? { phone: valueString(data, "Phone") } : {}),
          ...(primary !== undefined ? { primary } : {}),
        } });
        break;
      }
      case "Lead": {
        const existing = await tx.lead.findUnique({ where: { id } });
        if (!existing) throw new NativeCrmRecordError("Lead not found.", 404);
        const status = valueString(data, "Status");
        if (status && status !== existing.status) ensureLeadTransition(existing.status, status);
        const assigneeId = data.AssigneeId === undefined ? existing.assigneeId : valueString(data, "AssigneeId");
        if (assigneeId !== existing.assigneeId && !can(user.role, "leads:assign")) throw new NativeCrmRecordError("You cannot reassign leads.", 403);
        const customerId = data.AccountId === undefined ? existing.customerId : valueString(data, "AccountId");
        if (customerId) await requireAccount(tx, customerId, user);
        await tx.lead.update({ where: { id }, data: {
          ...(data.Name !== undefined ? { name: valueString(data, "Name", true)! } : {}),
          ...(data.Email !== undefined ? { email: valueString(data, "Email") } : {}),
          ...(data.Phone !== undefined ? { phone: valueString(data, "Phone") } : {}),
          ...(data.Source !== undefined ? { source: valueString(data, "Source", true)! } : {}),
          ...(data.Interest !== undefined ? { interest: valueString(data, "Interest") } : {}),
          ...(data.EstimatedQuantity !== undefined ? { estimatedQuantity: valueNumber(data, "EstimatedQuantity") } : {}),
          ...(data.Notes !== undefined ? { notes: valueString(data, "Notes") } : {}),
          ...(status ? { status: status as typeof existing.status } : {}),
          ...(data.NextFollowUpAt !== undefined ? { nextFollowUpAt: valueDate(data, "NextFollowUpAt") } : {}),
          ...(data.AccountId !== undefined ? { customerId } : {}),
          ...(data.AssigneeId !== undefined ? { assigneeId } : {}),
          activities: { create: { authorId: user.id, kind: "UPDATED", note: "Lead details updated" } },
        } });
        break;
      }
      case "Product": {
        const categoryId = data.CategoryId === undefined ? undefined : valueString(data, "CategoryId");
        if (categoryId && !await tx.productCategory.findUnique({ where: { id: categoryId }, select: { id: true } })) {
          throw new NativeCrmRecordError("Product category not found.", 400);
        }
        await tx.product.update({ where: { id }, data: {
          ...(data.ProductCode !== undefined ? { sku: valueString(data, "ProductCode", true)! } : {}),
          ...(data.Name !== undefined ? { name: valueString(data, "Name", true)! } : {}),
          ...(data.Description !== undefined ? { description: valueString(data, "Description") } : {}),
          ...(data.Brand !== undefined ? { brand: valueString(data, "Brand") } : {}),
          ...(data.Model !== undefined ? { model: valueString(data, "Model") } : {}),
          ...(data.ManufacturerPart !== undefined ? { manufacturerPart: valueString(data, "ManufacturerPart") } : {}),
          ...(data.Price !== undefined ? { unitPrice: valueNumber(data, "Price") } : {}),
          ...(data.TrackingType !== undefined ? { trackingType: valueString(data, "TrackingType") as "SERIAL" | "QUANTITY" } : {}),
          ...(data.WarrantyMonths !== undefined ? { warrantyMonths: valueNumber(data, "WarrantyMonths") } : {}),
          ...(data.Active !== undefined ? { active: valueBoolean(data, "Active") } : {}),
          ...(data.CategoryId !== undefined ? { categoryId } : {}),
        } });
        break;
      }
      case "Quote": {
        const existing = await tx.quote.findUnique({ where: { id } });
        if (!existing) throw new NativeCrmRecordError("Quote not found.", 404);
        const status = valueString(data, "Status");
        if (status && status !== existing.status) {
          const allowed = existing.status === "DRAFT" ? ["SENT", "REJECTED", "EXPIRED"] :
            existing.status === "SENT" ? ["ACCEPTED", "REJECTED", "EXPIRED"] : [];
          if (!allowed.includes(status)) throw new NativeCrmRecordError("Choose a valid quote status transition.", 409);
        }
        const changesDetails = data.Discount !== undefined || data.ValidUntil !== undefined;
        if (existing.status !== "DRAFT" && changesDetails) throw new NativeCrmRecordError("Only draft quotes can have their details edited.", 409);
        const discount = data.Discount === undefined ? Number(existing.discount) : valueNumber(data, "Discount");
        const items = await tx.quoteItem.findMany({ where: { quoteId: id }, select: { quantity: true, unitPrice: true, discount: true } });
        const totals = calculateQuote(items.map((item) => ({ quantity: item.quantity, unitPrice: Number(item.unitPrice), discount: Number(item.discount) })), discount);
        await tx.quote.update({ where: { id }, data: {
          ...(status ? { status: status as "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" } : {}),
          ...(data.ValidUntil !== undefined ? { validUntil: valueDate(data, "ValidUntil") } : {}),
          ...(data.Discount !== undefined ? { discount, ...totals } : {}),
        } });
        break;
      }
      case "QuoteLineItem": {
        const existing = await tx.quoteItem.findUnique({ where: { id }, include: { quote: { select: { id: true, status: true } } } });
        if (!existing) throw new NativeCrmRecordError("Quote line item not found.", 404);
        if (existing.quote.status !== "DRAFT") throw new NativeCrmRecordError("Line items on non-draft quotes cannot be changed.", 409);
        const productId = valueString(data, "ProductId") || existing.productId;
        const product = await tx.product.findFirst({ where: { id: productId, active: true } });
        if (!product) throw new NativeCrmRecordError("Select an active product.", 400);
        await tx.quoteItem.update({ where: { id }, data: {
          productId,
          ...(productId !== existing.productId ? { skuSnapshot: product.sku } : {}),
          ...(data.Description !== undefined ? { description: valueString(data, "Description", true)! } : {}),
          ...(data.Quantity !== undefined ? { quantity: valueNumber(data, "Quantity") } : {}),
          ...(data.UnitPrice !== undefined ? { unitPrice: valueNumber(data, "UnitPrice") } : {}),
          ...(data.Discount !== undefined ? { discount: valueNumber(data, "Discount") } : {}),
        } });
        await updateQuoteTotals(tx, existing.quoteId);
        await writeNativeRecordMetadata(tx, "Quote", existing.quoteId, user.id);
        break;
      }
      case "Order": {
        const existing = await tx.order.findUnique({ where: { id }, select: { status: true } });
        if (!existing) throw new NativeCrmRecordError("Order not found.", 404);
        if (data.Status !== undefined) throw new NativeCrmRecordError("Order status is controlled by dispatch and delivery workflows.", 409);
        await tx.order.update({ where: { id }, data: {
          ...(data.InvoiceReference !== undefined ? { invoiceReference: valueString(data, "InvoiceReference") } : {}),
        } });
        break;
      }
      case "OrderItem": {
        const existing = await tx.orderItem.findUnique({ where: { id }, include: { order: { select: { id: true, status: true } }, shipments: { select: { quantity: true } }, units: { select: { id: true } } } });
        if (!existing) throw new NativeCrmRecordError("Order item not found.", 404);
        if (existing.order.status !== "OPEN" || existing.shipments.length || existing.units.length) {
          throw new NativeCrmRecordError("Order items with shipments, warranty units, or a non-open order cannot be edited.", 409);
        }
        const productId = valueString(data, "ProductId") || existing.productId;
        const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, sku: true } });
        if (!product) throw new NativeCrmRecordError("Product not found.", 400);
        const quantity = data.Quantity === undefined ? existing.quantity : valueNumber(data, "Quantity");
        const unitPrice = data.UnitPrice === undefined ? Number(existing.unitPrice) : valueNumber(data, "UnitPrice");
        if (!Number.isInteger(quantity) || quantity < 1 || unitPrice < 0) throw new NativeCrmRecordError("Order item quantity and unit price are invalid.", 400);
        await tx.orderItem.update({ where: { id }, data: {
          productId,
          ...(productId !== existing.productId ? { skuSnapshot: product.sku } : {}),
          ...(data.Description !== undefined ? { description: valueString(data, "Description", true)! } : {}),
          ...(data.Quantity !== undefined ? { quantity } : {}),
          ...(data.UnitPrice !== undefined ? { unitPrice } : {}),
        } });
        await updateOrderTotals(tx, existing.orderId);
        await writeNativeRecordMetadata(tx, "Order", existing.orderId, user.id);
        break;
      }
      case "Case": {
        const existing = await tx.serviceTicket.findUnique({ where: { id } });
        if (!existing) throw new NativeCrmRecordError("Case not found.", 404);
        if (existing.status === "CLOSED") throw new NativeCrmRecordError("Closed cases cannot be changed.", 409);
        const status = valueString(data, "Status");
        const waitingReason = data.WaitingReason === undefined ? existing.waitingReason : valueString(data, "WaitingReason");
        const resolutionNote = data.ResolutionNote === undefined ? existing.resolutionNote : valueString(data, "ResolutionNote");
        const assigneeId = data.AssigneeId === undefined ? existing.assigneeId : valueString(data, "AssigneeId");
        const effectiveStatus = status || existing.status;
        if (effectiveStatus !== "NEW" && !assigneeId) throw new NativeCrmRecordError("Assign this case to a service agent or technician before continuing in this status.", 400);
        const repairingUnassignedCase = existing.status === "ASSIGNED" && !existing.assigneeId && status === "NEW";
        if (status && !repairingUnassignedCase) ensureCaseTransition(existing.status, status);
        if (status === "WAITING" && !waitingReason?.trim()) throw new NativeCrmRecordError("A waiting reason is required.", 400);
        if (status === "CLOSED" && existing.status !== "RESOLVED") throw new NativeCrmRecordError("Resolve the case before closing it.", 409);
        if (status === "CLOSED" && !resolutionNote?.trim()) throw new NativeCrmRecordError("A resolution note is required before closing.", 400);
        if (data.AssigneeId !== undefined && !can(user.role, "service:assign")) throw new NativeCrmRecordError("You cannot assign cases.", 403);
        if (data.AssigneeId !== undefined && assigneeId) {
          const assignee = await tx.user.findFirst({
            where: { id: assigneeId, active: true, role: { in: ["SERVICE_AGENT", "TECHNICIAN"] } },
            select: { id: true },
          });
          if (!assignee) throw new NativeCrmRecordError("Choose an active service agent or technician.", 400);
        }
        await tx.serviceTicket.update({ where: { id }, data: {
          ...(data.Subject !== undefined || data.Title !== undefined ? { title: valueString(data, "Subject") || valueString(data, "Title", true)! } : {}),
          ...(data.Description !== undefined ? { description: valueString(data, "Description", true)! } : {}),
          ...(data.Type !== undefined ? { type: valueString(data, "Type", true)! } : {}),
          ...(data.Priority !== undefined ? { priority: valueString(data, "Priority") as "LOW" | "NORMAL" | "HIGH" | "URGENT" } : {}),
          ...(status ? { status: status as "ASSIGNED" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED" } : {}),
          ...(data.WaitingReason !== undefined ? { waitingReason } : {}),
          ...(data.ResolutionNote !== undefined ? { resolutionNote } : {}),
          ...(data.Diagnosis !== undefined ? { diagnosis: valueString(data, "Diagnosis") } : {}),
          ...(data.PartsUsedNotes !== undefined ? { partsUsedNotes: valueString(data, "PartsUsedNotes") } : {}),
          ...(data.WarrantyDecision !== undefined ? { warrantyDecision: valueString(data, "WarrantyDecision") } : {}),
          ...(data.Chargeable !== undefined ? { chargeable: valueBoolean(data, "Chargeable") } : {}),
          ...(data.CustomerApproved !== undefined ? { customerApproved: valueBoolean(data, "CustomerApproved") } : {}),
          ...(data.HandoverNotes !== undefined ? { handoverNotes: valueString(data, "HandoverNotes") } : {}),
          ...(data.AssigneeId !== undefined ? { assigneeId } : {}),
          ...(status === "CLOSED" ? { closedAt: new Date() } : {}),
          updates: { create: { authorId: user.id, kind: "UPDATED", note: "Case details updated" } },
        } });
        break;
      }
      case "CaseComment":
        throw new NativeCrmRecordError("Case comments are immutable history. Add a new comment instead.", 409);
      default:
        throw new NativeCrmRecordError(`No native CRM record adapter exists for ${apiName}.`, 404);
    }
    await ensureUniqueNativeFieldValues(tx, apiName, id, fieldValues);
    await writeFieldValues(tx, apiName, id, fieldValues);
    await writeNativeRecordMetadata(tx, apiName, id, user.id);
    await writeAudit(tx, user.id, `${apiName.toUpperCase()}_UPDATED`, apiName, id);
  });
}

export async function deleteNativeCrmRecord(apiName: string, id: string, user: NativeCrmMutationUser) {
  if (!await getNativeCrmRecord(apiName, id, user, "edit")) throw new NativeCrmRecordError("Record not found.", 404);
  await prisma.$transaction(async (tx) => {
    switch (apiName) {
      case "Account": {
        const account = await tx.customer.findUnique({ where: { id }, include: {
          _count: { select: { contacts: true, addresses: true, leads: true, quotes: true, orders: true, units: true, tickets: true } },
        } });
        if (!account) throw new NativeCrmRecordError("Account not found.", 404);
        if (Object.values(account._count).some((count) => count > 0)) throw new NativeCrmRecordError("This account has related records or history. Keep it and update it instead of deleting it.", 409);
        await tx.customer.delete({ where: { id } });
        break;
      }
      case "Contact": {
        if (!await tx.contact.findUnique({ where: { id }, select: { id: true } })) throw new NativeCrmRecordError("Contact not found.", 404);
        await tx.contact.delete({ where: { id } });
        break;
      }
      case "Lead": {
        const lead = await tx.lead.findUnique({ where: { id }, select: { status: true, assigneeId: true, activities: { select: { id: true }, take: 1 }, quotes: { select: { id: true }, take: 1 } } });
        if (!lead) throw new NativeCrmRecordError("Lead not found.", 404);
        if (lead.status === "CONVERTED" || lead.activities.length || lead.quotes.length) throw new NativeCrmRecordError("This lead has conversion, quote, or activity history. Keep it and update its status instead of deleting it.", 409);
        await tx.lead.delete({ where: { id } });
        break;
      }
      case "Product": {
        const product = await tx.product.findUnique({ where: { id }, select: { quoteItems: { take: 1, select: { id: true } }, orderItems: { take: 1, select: { id: true } }, units: { take: 1, select: { id: true } } } });
        if (!product) throw new NativeCrmRecordError("Product not found.", 404);
        if (product.quoteItems.length || product.orderItems.length || product.units.length) throw new NativeCrmRecordError("This product has quote, order, or warranty history. Deactivate it instead of deleting it.", 409);
        await tx.product.delete({ where: { id } });
        break;
      }
      case "Quote": {
        const quote = await tx.quote.findUnique({ where: { id }, select: { status: true, order: { select: { id: true } }, items: { select: { id: true } } } });
        if (!quote) throw new NativeCrmRecordError("Quote not found.", 404);
        if (quote.status !== "DRAFT" || quote.order) throw new NativeCrmRecordError("Only unconverted draft quotes can be deleted.", 409);
        const itemIds = quote.items.map(({ id: itemId }) => itemId);
        await tx.crmNativeFieldValue.deleteMany({ where: { objectApiName: "QuoteLineItem", recordId: { in: itemIds } } });
        await tx.crmNativeRecordMetadata.deleteMany({ where: { objectApiName: "QuoteLineItem", recordId: { in: itemIds } } });
        await tx.quote.delete({ where: { id } });
        break;
      }
      case "QuoteLineItem": {
        const item = await tx.quoteItem.findUnique({ where: { id }, include: { quote: { select: { id: true, status: true } } } });
        if (!item) throw new NativeCrmRecordError("Quote line item not found.", 404);
        if (item.quote.status !== "DRAFT") throw new NativeCrmRecordError("Line items on non-draft quotes cannot be deleted.", 409);
        const count = await tx.quoteItem.count({ where: { quoteId: item.quoteId } });
        if (count < 2) throw new NativeCrmRecordError("A quote must retain at least one line item.", 409);
        await tx.quoteItem.delete({ where: { id } });
        await tx.crmNativeFieldValue.deleteMany({ where: { objectApiName: apiName, recordId: id } });
        await tx.crmNativeRecordMetadata.deleteMany({ where: { objectApiName: apiName, recordId: id } });
        await updateQuoteTotals(tx, item.quoteId);
        await writeNativeRecordMetadata(tx, "Quote", item.quoteId, user.id);
        break;
      }
      case "Order": {
        const order = await tx.order.findUnique({ where: { id }, include: {
          _count: { select: { shipments: true, tickets: true, items: true } },
          quote: { select: { id: true } },
          items: { select: { id: true, units: { select: { id: true } } } },
        } });
        if (!order) throw new NativeCrmRecordError("Order not found.", 404);
        if (order.quote || order._count.shipments || order._count.tickets || order.items.some((item) => item.units.length)) {
          throw new NativeCrmRecordError("This order is linked to a quote, shipment, case, or warranty record and cannot be deleted.", 409);
        }
        const itemIds = order.items.map(({ id: itemId }) => itemId);
        await tx.crmNativeFieldValue.deleteMany({ where: { objectApiName: "OrderItem", recordId: { in: itemIds } } });
        await tx.crmNativeRecordMetadata.deleteMany({ where: { objectApiName: "OrderItem", recordId: { in: itemIds } } });
        await tx.order.delete({ where: { id } });
        break;
      }
      case "OrderItem": {
        const item = await tx.orderItem.findUnique({ where: { id }, include: { order: { select: { id: true, status: true } }, shipments: { select: { id: true } }, units: { select: { id: true } } } });
        if (!item) throw new NativeCrmRecordError("Order item not found.", 404);
        if (item.order.status !== "OPEN" || item.shipments.length || item.units.length) throw new NativeCrmRecordError("Order items with shipment or warranty history cannot be deleted.", 409);
        if (await tx.orderItem.count({ where: { orderId: item.orderId } }) < 2) throw new NativeCrmRecordError("An order must retain at least one line item.", 409);
        await tx.orderItem.delete({ where: { id } });
        await tx.crmNativeFieldValue.deleteMany({ where: { objectApiName: apiName, recordId: id } });
        await tx.crmNativeRecordMetadata.deleteMany({ where: { objectApiName: apiName, recordId: id } });
        await updateOrderTotals(tx, item.orderId);
        await writeNativeRecordMetadata(tx, "Order", item.orderId, user.id);
        break;
      }
      case "Case": {
        const ticket = await tx.serviceTicket.findUnique({ where: { id }, select: { id: true, updates: { select: { id: true }, take: 1 } } });
        if (!ticket) throw new NativeCrmRecordError("Case not found.", 404);
        if (ticket.updates.length) throw new NativeCrmRecordError("Cases with service history cannot be deleted. Resolve or close the case instead.", 409);
        await tx.serviceTicket.delete({ where: { id } });
        break;
      }
      case "CaseComment":
        throw new NativeCrmRecordError("Case comments are immutable history and cannot be deleted.", 409);
      default:
        throw new NativeCrmRecordError(`No native CRM record adapter exists for ${apiName}.`, 404);
    }
    await tx.crmNativeFieldValue.deleteMany({ where: { objectApiName: apiName, recordId: id } });
    await tx.crmNativeRecordMetadata.deleteMany({ where: { objectApiName: apiName, recordId: id } });
    await writeAudit(tx, user.id, `${apiName.toUpperCase()}_DELETED`, apiName, id);
  });
}
