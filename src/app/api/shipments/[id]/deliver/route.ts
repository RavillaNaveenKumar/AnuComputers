import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { normalizeSerial } from "@/lib/references";
import { validateDelivery } from "@/lib/business";
import { audit } from "@/lib/audit";
import { z } from "zod";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const schema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  items: z.array(z.object({
    shipmentItemId: z.string(),
    quantity: z.coerce.number().int().min(1),
    serials: z.array(z.string().trim().min(1).max(120)).default([]),
  })).min(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ capability: "dispatch:write", objectApiName: "Order", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const shipmentOrder = await prisma.shipment.findUnique({ where: { id }, select: { orderId: true } });
  if (!shipmentOrder || !await getNativeCrmRecord("Order", shipmentOrder.orderId, user, "edit")) {
    return NextResponse.json({ error: "Shipment not found." }, { status: 404 });
  }
  const input = schema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const [orderFields, itemFields, productFields] = await Promise.all([
    evaluateNativeFieldAuthorization(user, "Order", ["Status"], "edit"),
    evaluateNativeFieldAuthorization(user, "OrderItem", ["Quantity", "ProductId"], "read"),
    evaluateNativeFieldAuthorization(user, "Product", ["TrackingType", "WarrantyMonths"], "read"),
  ]);
  for (const result of [orderFields, itemFields, productFields]) {
    if (!result.allowed) return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const key = `delivery:${input.data.idempotencyKey}`;
  const prior = await prisma.idempotencyRecord.findUnique({ where: { key } });
  if (prior) return NextResponse.json(prior.result);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.idempotencyRecord.findUnique({ where: { key } });
      if (duplicate) return duplicate.result;
      const shipment = await tx.shipment.findUnique({
        where: { id },
        include: { order: true, items: { include: { orderItem: { include: { product: true, shipments: true, units: true } } } } },
      });
      if (!shipment) throw new Error("NOT_FOUND");
      const selected = new Set<string>();
      for (const requested of input.data.items) {
        if (selected.has(requested.shipmentItemId)) throw new Error("DUPLICATE_LINE");
        selected.add(requested.shipmentItemId);
        const line = shipment.items.find((item) => item.id === requested.shipmentItemId);
        if (!line) throw new Error("INVALID_LINE");
        const totalDispatched = line.orderItem.shipments.reduce((sum, part) => sum + part.quantity, 0);
        const totalDelivered = line.orderItem.shipments.reduce((sum, part) => sum + part.delivered, 0);
        const serials = requested.serials.map(normalizeSerial);
        validateDelivery(line.orderItem.quantity, totalDispatched, totalDelivered, requested.quantity, line.orderItem.product.trackingType, serials);
        if (new Set(serials).size !== serials.length) throw new Error("DUPLICATE_SERIAL");
        await tx.shipmentItem.update({ where: { id: line.id }, data: { delivered: { increment: requested.quantity }, serials: { push: serials } } });
        if (serials.length) {
          const warrantyStart = new Date();
          const warrantyEnd = new Date(warrantyStart);
          warrantyEnd.setMonth(warrantyEnd.getMonth() + line.orderItem.product.warrantyMonths);
          await tx.purchasedUnit.createMany({ data: serials.map((serial) => ({
            customerId: shipment.order.customerId,
            productId: line.orderItem.productId,
            orderItemId: line.orderItemId,
            serial: requested.serials[serials.indexOf(serial)],
            normalizedSerial: serial,
            warrantyStart,
            warrantyEnd: line.orderItem.product.warrantyMonths ? warrantyEnd : null,
          })) });
        }
      }
      const updatedShipmentItems = await tx.shipmentItem.findMany({ where: { shipmentId: id } });
      const shipmentComplete = updatedShipmentItems.every((line) => line.delivered >= line.quantity);
      if (shipmentComplete) await tx.shipment.update({ where: { id }, data: { deliveredAt: new Date() } });
      const allOrderItems = await tx.orderItem.findMany({ where: { orderId: shipment.orderId }, include: { shipments: true } });
      const orderComplete = allOrderItems.every((item) => item.shipments.reduce((sum, part) => sum + part.delivered, 0) >= item.quantity);
      const anyDelivered = allOrderItems.some((item) => item.shipments.some((part) => part.delivered > 0));
      await tx.order.update({ where: { id: shipment.orderId }, data: { status: orderComplete ? "DELIVERED" : anyDelivered ? "PARTIALLY_SHIPPED" : "OPEN" } });
      await writeNativeRecordMetadata(tx, "Order", shipment.orderId, user.id);
      const response = { shipmentId: id, shipmentDelivered: shipmentComplete, orderDelivered: orderComplete };
      await tx.idempotencyRecord.create({ data: { key, operation: "DELIVERY", result: response } });
      return response;
    }, { isolationLevel: "Serializable" });
    await audit(user.id, "DELIVERY_CONFIRMED", "Shipment", id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      const conflicts = ["INVALID_LINE", "DUPLICATE_LINE", "DUPLICATE_SERIAL", "Delivery quantity must be positive and cannot exceed dispatched quantity.", "Provide one serial number for each serialized unit being delivered.", "Quantity-tracked items do not accept per-unit serial numbers."];
      if (error.message === "NOT_FOUND") return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
      if (conflicts.includes(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
