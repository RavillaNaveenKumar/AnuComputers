import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export async function GET() {
  const authorization = await evaluateAuthorization({ objectApiName: "Order", objectCapability: "canRead" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const [accountAuthorization, productAuthorization, itemAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "OrderItem", objectCapability: "canRead" }),
  ]);
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Order", [
    "Name", "AccountId", "QuoteId", "Status", "InvoiceReference", "OwnerId",
  ], "read");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  if (accountAuthorization.allowed) {
    const accountFields = await evaluateNativeFieldAuthorization(user, "Account", ["Name", "Phone"], "read");
    if (!accountFields.allowed) return NextResponse.json({ error: accountFields.error }, { status: accountFields.status });
  }
  if (itemAuthorization.allowed) {
    const itemFields = await evaluateNativeFieldAuthorization(user, "OrderItem", ["OrderId", "ProductId", "SKU", "Description", "Quantity"], "read");
    if (!itemFields.allowed) return NextResponse.json({ error: itemFields.error }, { status: itemFields.status });
  }
  if (productAuthorization.allowed) {
    const productFields = await evaluateNativeFieldAuthorization(user, "Product", ["TrackingType"], "read");
    if (!productFields.allowed) return NextResponse.json({ error: productFields.error }, { status: productFields.status });
  }
  const [totalFields, priceFields, shippingAddressFields] = await Promise.all([
    evaluateNativeFieldAuthorization(user, "Order", ["Subtotal", "Total"], "read"),
    itemAuthorization.allowed
      ? evaluateNativeFieldAuthorization(user, "OrderItem", ["UnitPrice"], "read")
      : Promise.resolve({ allowed: false as const }),
    evaluateNativeFieldAuthorization(user, "Order", ["ShippingAddress"], "read"),
  ]);
  const [accessibleIds, accountIds, productIds, itemIds] = await Promise.all([
    listNativeCrmRecordIds("Order", user),
    accountAuthorization.allowed ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
    productAuthorization.allowed ? listNativeCrmRecordIds("Product", user) : Promise.resolve([]),
    itemAuthorization.allowed ? listNativeCrmRecordIds("OrderItem", user) : Promise.resolve([]),
  ]);
  const orders = await prisma.order.findMany({
    where: { id: { in: accessibleIds } },
    include: { customer: { select: { id: true, name: true, phone: true } }, items: { where: { id: { in: itemIds } }, include: { product: { select: { id: true, trackingType: true } }, shipments: true } }, shipments: itemAuthorization.allowed },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const visibleOrders = orders.map((order) => {
    const items = order.items.map(({ unitPrice, ...item }) => ({
      ...item,
      product: productIds.includes(item.product.id) ? item.product : null,
      ...(priceFields.allowed ? { unitPrice } : {}),
    }));
    return {
      ...order,
      customer: accountIds.includes(order.customer.id) ? order.customer : { ...order.customer, name: "Restricted", phone: null },
      items,
      ...(totalFields.allowed ? {} : { subtotal: undefined, total: undefined }),
      ...(shippingAddressFields.allowed ? {} : { shippingSnapshot: undefined }),
    };
  });
  return NextResponse.json(visibleOrders);
}
