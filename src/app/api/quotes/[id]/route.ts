import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { reference } from "@/lib/references";
import { z } from "zod";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const statusSchema = z.object({ status: z.enum(["SENT", "ACCEPTED", "REJECTED", "EXPIRED"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Quote", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Quote", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Quote", ["Status"], "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const existingQuote = await prisma.quote.findUnique({ where: { id }, select: { createdById: true } });
  if (!existingQuote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  const input = statusSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const updated = await prisma.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({ where: { id } });
    if (!quote) throw new Error("NOT_FOUND");
    const allowed = quote.status === "DRAFT" ? ["SENT", "REJECTED", "EXPIRED"] :
      quote.status === "SENT" ? ["ACCEPTED", "REJECTED", "EXPIRED"] : [];
    if (!allowed.includes(input.data.status)) throw new Error("INVALID_TRANSITION");
    const updated = await tx.quote.update({ where: { id }, data: { status: input.data.status } });
    await writeNativeRecordMetadata(tx, "Quote", id, user.id);
    return updated;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NOT_FOUND") return null;
    throw error;
  });
  if (!updated) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  await audit(user.id, `QUOTE_${updated.status}`, "Quote", id);
  return NextResponse.json({ success: true, id: updated.id });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Order", objectCapability: "canCreate" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Quote", id, user);
  if (!accessible) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  const orderFields = await evaluateNativeFieldAuthorization(user, "Order", ["AccountId", "QuoteId", "Status", "InvoiceReference", "Subtotal", "Total", "OwnerId"], "edit");
  if (!orderFields.allowed) return NextResponse.json({ error: orderFields.error }, { status: orderFields.status });
  const [quoteAddressAuthorization, orderAddressEditAuthorization] = await Promise.all([
    evaluateNativeFieldAuthorization(user, "Quote", ["AddressSnapshot"], "read"),
    evaluateNativeFieldAuthorization(user, "Order", ["ShippingAddress"], "edit"),
  ]);
  for (const result of [quoteAddressAuthorization, orderAddressEditAuthorization]) {
    if (!result.allowed) return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const itemFields = await evaluateNativeFieldAuthorization(user, "OrderItem", ["OrderId", "ProductId", "SKU", "Description", "Quantity", "UnitPrice"], "edit");
  if (!itemFields.allowed) return NextResponse.json({ error: itemFields.error }, { status: itemFields.status });
  const existingQuote = await prisma.quote.findUnique({ where: { id }, select: { createdById: true } });
  if (!existingQuote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  const body = z.object({ action: z.literal("create-order"), invoiceReference: z.string().max(100).optional() }).safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    const order = await prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findUnique({ where: { id }, include: { items: true } });
      if (!quote) throw new Error("NOT_FOUND");
      if (quote.status !== "ACCEPTED") throw new Error("QUOTE_NOT_ACCEPTED");
      const current = await tx.order.findUnique({ where: { quoteId: id } });
      if (current) return current;
      const created = await tx.order.create({ data: {
        reference: reference("ORD"),
        customerId: quote.customerId,
        ownerId: quote.createdById,
        quoteId: quote.id,
        invoiceReference: body.data.invoiceReference || null,
        subtotal: quote.subtotal,
        total: quote.total,
        shippingSnapshot: quote.addressSnapshot ?? undefined,
        items: { create: quote.items.map((item) => ({
          productId: item.productId,
          skuSnapshot: item.skuSnapshot,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })) },
      }, include: { items: { select: { id: true } } } });
      await writeNativeRecordMetadata(tx, "Order", created.id, user.id, true);
      for (const item of created.items) await writeNativeRecordMetadata(tx, "OrderItem", item.id, user.id, true);
      return created;
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
    await audit(user.id, "ORDER_CREATED_FROM_QUOTE", "Order", order.id, { quoteId: id });
    return NextResponse.json({ success: true, id: order.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    if (error instanceof Error && error.message === "QUOTE_NOT_ACCEPTED") return NextResponse.json({ error: "Only accepted quotes can create an order." }, { status: 409 });
    const existing = await prisma.order.findUnique({ where: { quoteId: id } });
    if (existing) return NextResponse.json({ success: true, id: existing.id });
    throw error;
  }
}
