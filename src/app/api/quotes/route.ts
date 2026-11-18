import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { quoteSchema } from "@/lib/validators";
import { calculateQuote } from "@/lib/business";
import { reference } from "@/lib/references";
import { audit } from "@/lib/audit";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { filterAccessibleCrmRecords } from "@/lib/crm-record-access";
import { syncStandardCrmFields } from "@/lib/crm-registry";

export async function GET() {
  const authorization = await evaluateAuthorization({ objectApiName: "Quote", objectCapability: "canRead" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const [accountAuthorization, itemAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "QuoteLineItem", objectCapability: "canRead" }),
  ]);
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Quote", [
    "Name", "AccountId", "LeadId", "Status", "Subtotal", "Discount", "Total", "ValidUntil", "AddressSnapshot",
  ], "read");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  if (accountAuthorization.allowed) {
    const accountFields = await evaluateNativeFieldAuthorization(user, "Account", ["Name"], "read");
    if (!accountFields.allowed) return NextResponse.json({ error: accountFields.error }, { status: accountFields.status });
  }
  if (itemAuthorization.allowed) {
    const itemFields = await evaluateNativeFieldAuthorization(user, "QuoteLineItem", ["QuoteId", "ProductId", "SKU", "Description", "Quantity"], "read");
    if (!itemFields.allowed) return NextResponse.json({ error: itemFields.error }, { status: itemFields.status });
    const priceFields = await evaluateNativeFieldAuthorization(user, "QuoteLineItem", ["UnitPrice", "Discount"], "read");
    if (!priceFields.allowed) return NextResponse.json({ error: priceFields.error }, { status: priceFields.status });
  }
  const [accessibleIds, accountIds, itemIds] = await Promise.all([
    listNativeCrmRecordIds("Quote", user),
    accountAuthorization.allowed ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
    itemAuthorization.allowed ? listNativeCrmRecordIds("QuoteLineItem", user) : Promise.resolve([]),
  ]);
  const quotes = await prisma.quote.findMany({
    where: { id: { in: accessibleIds } },
    include: { customer: { select: { id: true, name: true } }, items: { where: { id: { in: itemIds } } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(quotes.map((quote) => ({
    ...quote,
    customer: accountIds.includes(quote.customer.id) ? quote.customer : { ...quote.customer, name: "Restricted" },
  })));
}

export async function POST(request: Request) {
  const authorization = await evaluateAuthorization({ objectApiName: "Quote", objectCapability: "canCreate" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  await syncStandardCrmFields(prisma);
  const input = quoteSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const quoteFieldNames = [
    "AccountId",
    ...(input.data.leadId ? ["LeadId"] : []),
    ...(input.data.opportunityId ? ["OpportunityId"] : []),
    ...(input.data.validUntil ? ["ValidUntil"] : []),
    "Discount",
    "AddressSnapshot",
  ];
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Quote", quoteFieldNames, "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const lineFieldNames = [
    "ProductId", "Quantity", "UnitPrice",
    ...(input.data.items.some((item) => item.discount > 0) ? ["Discount"] : []),
  ];
  const lineFieldAuthorization = await evaluateNativeFieldAuthorization(user, "QuoteLineItem", lineFieldNames, "edit");
  if (!lineFieldAuthorization.allowed) return NextResponse.json({ error: lineFieldAuthorization.error }, { status: lineFieldAuthorization.status });
  const [accountAuthorization, productAuthorization, leadAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
    input.data.leadId ? evaluateUserAuthorization(user, { objectApiName: "Lead", objectCapability: "canRead" }) : Promise.resolve({ allowed: true as const, user }),
  ]);
  if (!accountAuthorization.allowed || !productAuthorization.allowed || !leadAuthorization.allowed) return NextResponse.json({ error: "You do not have access to one or more related records." }, { status: 403 });
  const opportunityAuthorization = input.data.opportunityId
    ? await evaluateUserAuthorization(user, { objectApiName: "Opportunity", objectCapability: "canRead" })
    : null;
  if (opportunityAuthorization && !opportunityAuthorization.allowed) return NextResponse.json({ error: "You do not have access to opportunities." }, { status: 403 });
  const accountAddressAuthorization = await evaluateNativeFieldAuthorization(user, "Account", ["AddressDetails"], "read");
  if (!accountAddressAuthorization.allowed) return NextResponse.json({ error: accountAddressAuthorization.error }, { status: accountAddressAuthorization.status });
  const [customer, products, lead] = await Promise.all([
    getNativeCrmRecord("Account", input.data.customerId, user)
      .then((record) => record ? prisma.customer.findUnique({ where: { id: input.data.customerId }, select: { id: true, ownerId: true, addresses: { where: { label: "Shipping" }, take: 1 } } }) : null),
    prisma.product.findMany({ where: { id: { in: input.data.items.map((item) => item.productId) }, active: true } }),
    input.data.leadId
      ? getNativeCrmRecord("Lead", input.data.leadId, user).then((record) => record
        ? prisma.lead.findUnique({ where: { id: input.data.leadId! }, select: { id: true, customerId: true, status: true, assigneeId: true } })
        : null)
      : Promise.resolve(null),
  ]);
  const opportunityObject = input.data.opportunityId ? await prisma.crmObject.findUnique({ where: { apiName: "Opportunity" }, select: { id: true } }) : null;
  const opportunityCandidate = opportunityObject && input.data.opportunityId
    ? await prisma.crmRecord.findFirst({ where: { id: input.data.opportunityId, objectId: opportunityObject.id }, select: { id: true, ownerId: true, data: true } })
    : null;
  const opportunity = opportunityCandidate && opportunityObject
    ? (await filterAccessibleCrmRecords(user, opportunityObject.id, [opportunityCandidate], "read"))[0] ?? null
    : null;
  const accessibleProductIds = await listNativeCrmRecordIds("Product", user);
  if (input.data.items.some((item) => !accessibleProductIds.includes(item.productId))) {
    return NextResponse.json({ error: "You do not have access to one or more products." }, { status: 403 });
  }
  const opportunityData = opportunity?.data as Record<string, unknown> | undefined;
  if (!customer || (input.data.leadId && (!lead || !["QUALIFIED", "CONVERTED"].includes(lead.status) || lead.customerId !== customer.id)) ||
      (input.data.opportunityId && (!opportunity || opportunityData?.AccountId !== customer.id || (input.data.leadId && opportunityData?.LeadId !== input.data.leadId))) ||
      (lead && user.role === "SALES_EXECUTIVE" && lead.assigneeId !== user.id) ||
      (user.role === "SALES_EXECUTIVE" && customer.ownerId !== user.id && lead?.assigneeId !== user.id)) {
    return NextResponse.json({ error: "Customer or lead relationship is invalid." }, { status: 400 });
  }
  if (products.length !== new Set(input.data.items.map((item) => item.productId)).size) {
    return NextResponse.json({ error: "One or more products are unavailable." }, { status: 400 });
  }
  const totals = calculateQuote(input.data.items, input.data.discount);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const quote = await prisma.$transaction(async (tx) => {
    const record = await tx.quote.create({ data: {
      reference: reference("QUO"),
      customerId: customer.id,
      leadId: lead?.id,
      createdById: user.id,
      subtotal: totals.subtotal,
      discount: input.data.discount,
      total: totals.total,
      validUntil: input.data.validUntil,
      addressSnapshot: customer.addresses[0] ?? undefined,
      items: { create: input.data.items.map((item) => {
        const product = productMap.get(item.productId)!;
        return {
          productId: product.id,
          skuSnapshot: product.sku,
          description: product.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
        };
      }) },
    }, include: { items: { select: { id: true } } } });
    if (input.data.opportunityId) {
      const opportunityField = await tx.crmField.findFirst({ where: { object: { apiName: "Quote" }, apiName: "OpportunityId", active: true }, select: { id: true } });
      if (!opportunityField) throw new Error("Quote opportunity field is not configured.");
      await tx.crmNativeFieldValue.create({ data: {
        objectApiName: "Quote", recordId: record.id, fieldId: opportunityField.id, value: input.data.opportunityId,
      } });
    }
    await writeNativeRecordMetadata(tx, "Quote", record.id, user.id, true);
    for (const item of record.items) await writeNativeRecordMetadata(tx, "QuoteLineItem", item.id, user.id, true);
    return record;
  });
  await audit(user.id, "QUOTE_CREATED", "Quote", quote.id);
  return NextResponse.json({ success: true, id: quote.id }, { status: 201 });
}
