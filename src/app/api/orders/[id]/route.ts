import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { reference } from "@/lib/references";
import { calculateQuote } from "@/lib/business";
import { getNativeCrmRecord, listNativeCrmRecordIds } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const directOrderSchema = z.object({
  customerId: z.string().min(1),
  invoiceReference: z.string().max(100).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().int().min(1).max(100000),
    unitPrice: z.coerce.number().finite().min(0),
  })).min(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Order", objectCapability: "canCreate" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  if (id !== "direct") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const input = directOrderSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const [orderFields, itemFields, productFields] = await Promise.all([
    evaluateNativeFieldAuthorization(user, "Order", ["AccountId", "InvoiceReference", "Subtotal", "Total", "OwnerId", "ShippingAddress"], "edit"),
    evaluateNativeFieldAuthorization(user, "OrderItem", ["OrderId", "ProductId", "SKU", "Description", "Quantity", "UnitPrice"], "edit"),
    evaluateNativeFieldAuthorization(user, "Product", ["ProductCode", "Name"], "read"),
  ]);
  for (const result of [orderFields, itemFields, productFields]) {
    if (!result.allowed) return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const [accountAuthorization, productAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
  ]);
  if (!accountAuthorization.allowed || !productAuthorization.allowed) return NextResponse.json({ error: "You do not have access to one or more related records." }, { status: 403 });
  const accountAddressAuthorization = await evaluateNativeFieldAuthorization(user, "Account", ["AddressDetails"], "read");
  if (!accountAddressAuthorization.allowed) return NextResponse.json({ error: accountAddressAuthorization.error }, { status: accountAddressAuthorization.status });
  const [accessibleCustomer, accessibleProductIds] = await Promise.all([
    getNativeCrmRecord("Account", input.data.customerId, user),
    listNativeCrmRecordIds("Product", user),
  ]);
  if (!accessibleCustomer || input.data.items.some((item) => !accessibleProductIds.includes(item.productId))) {
    return NextResponse.json({ error: "You do not have access to one or more related records." }, { status: 403 });
  }
  const [customer, products] = await Promise.all([
    prisma.customer.findUnique({ where: { id: input.data.customerId }, select: { id: true, addresses: { where: { label: "Shipping" }, take: 1 } } }),
    prisma.product.findMany({ where: { id: { in: input.data.items.map((item) => item.productId) }, active: true } }),
  ]);
  if (!customer || products.length !== new Set(input.data.items.map((item) => item.productId)).size) {
    return NextResponse.json({ error: "Customer or product relationship is invalid." }, { status: 400 });
  }
  const totals = calculateQuote(input.data.items.map((item) => ({ ...item, discount: 0 })), 0);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const order = await prisma.$transaction(async (tx) => {
    const record = await tx.order.create({ data: {
      reference: reference("ORD"),
      customerId: customer.id,
      ownerId: user.id,
      invoiceReference: input.data.invoiceReference || null,
      subtotal: totals.subtotal,
      total: totals.total,
      shippingSnapshot: customer.addresses[0] ?? undefined,
      items: { create: input.data.items.map((item) => {
        const product = productMap.get(item.productId)!;
        return { productId: product.id, skuSnapshot: product.sku, description: product.name, quantity: item.quantity, unitPrice: item.unitPrice };
      }) },
    }, include: { items: { select: { id: true } } } });
    await writeNativeRecordMetadata(tx, "Order", record.id, user.id, true);
    for (const item of record.items) await writeNativeRecordMetadata(tx, "OrderItem", item.id, user.id, true);
    return record;
  });
  await audit(user.id, "DIRECT_ORDER_CREATED", "Order", order.id);
  return NextResponse.json({ success: true, id: order.id }, { status: 201 });
}
