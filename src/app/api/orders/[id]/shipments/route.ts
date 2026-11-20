import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { reference } from "@/lib/references";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const schema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  carrier: z.string().max(100).optional(),
  tracking: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(z.object({ orderItemId: z.string(), quantity: z.coerce.number().int().min(1) })).min(1),
}).superRefine((value, context) => {
  const ids = value.items.map((item) => item.orderItemId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Each order line can appear only once per shipment." });
  }
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ capability: "dispatch:write", objectApiName: "Order", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Order", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const input = schema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const idempotencyKey = `shipment:${id}:${input.data.idempotencyKey}`;
  const [orderFields, itemFields] = await Promise.all([
    evaluateNativeFieldAuthorization(user, "Order", ["Status"], "edit"),
    evaluateNativeFieldAuthorization(user, "OrderItem", ["Quantity"], "read"),
  ]);
  for (const result of [orderFields, itemFields]) {
    if (!result.allowed) return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const prior = await prisma.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
  if (prior) {
    const saved = prior.result as unknown as { id?: unknown; reference?: unknown };
    if (typeof saved.id !== "string" || typeof saved.reference !== "string") {
      return NextResponse.json({ error: "This shipment request key has an invalid saved result. Contact an administrator before retrying." }, { status: 500 });
    }
    revalidatePath("/orders");
    revalidatePath(`/orders/${id}`);
    return NextResponse.json({ id: saved.id, reference: saved.reference });
  }
  const shipment = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, include: { items: { include: { shipments: true } } } });
    if (!order || order.status === "CANCELLED") throw new Error("INVALID_ORDER");
    const itemsById = new Map(order.items.map((item) => [item.id, item]));
    for (const requested of input.data.items) {
      const item = itemsById.get(requested.orderItemId);
      if (!item) throw new Error("INVALID_ITEM");
      const alreadyDispatched = item.shipments.reduce((sum, part) => sum + part.quantity, 0);
      const sameRequestQuantity = input.data.items.filter((part) => part.orderItemId === requested.orderItemId).reduce((sum, part) => sum + part.quantity, 0);
      if (alreadyDispatched + sameRequestQuantity > item.quantity) throw new Error("OVER_SHIP");
    }
    const created = await tx.shipment.create({ data: {
      reference: reference("SHP"),
      orderId: id,
      shippedAt: new Date(),
      carrier: input.data.carrier || null,
      tracking: input.data.tracking || null,
      notes: input.data.notes || null,
      items: { create: input.data.items },
    } });
    const allItems = await tx.orderItem.findMany({ where: { orderId: id }, include: { shipments: true } });
    const allDispatched = allItems.every((item) => item.shipments.reduce((sum, line) => sum + line.quantity, 0) >= item.quantity);
    await tx.order.update({ where: { id }, data: { status: allDispatched ? "SHIPPED" : "PARTIALLY_SHIPPED" } });
    await writeNativeRecordMetadata(tx, "Order", id, user.id);
    return { id: created.id, reference: created.reference };
  }).catch((error: unknown) => {
    if (error instanceof Error && ["INVALID_ORDER", "INVALID_ITEM", "OVER_SHIP"].includes(error.message)) return { error: error.message };
    console.error("Shipment creation transaction failed", { orderId: id, error });
    return { error: "UNEXPECTED" };
  });
  if ("error" in shipment) {
    const status = shipment.error === "INVALID_ORDER" ? 404 : shipment.error === "UNEXPECTED" ? 500 : 409;
    const message = shipment.error === "UNEXPECTED"
      ? "The shipment could not be saved. No shipment was created; retry this request using the same form."
      : shipment.error;
    return NextResponse.json({ error: message }, { status });
  }
  try {
    await prisma.idempotencyRecord.create({ data: { key: idempotencyKey, operation: "SHIPMENT", result: shipment } });
  } catch (error) {
    // The dispatch is already committed. A secondary idempotency write failure
    // must not report that shipment creation failed and prompt a duplicate retry.
    console.error("Shipment idempotency write failed after shipment creation", { shipmentId: shipment.id, error });
  }
  try {
    await audit(user.id, "SHIPMENT_CREATED", "Shipment", shipment.id, { orderId: id });
  } catch (error) {
    console.error("Shipment audit write failed after shipment creation", { shipmentId: shipment.id, error });
  }
  revalidatePath("/orders");
  revalidatePath(`/orders/${id}`);
  return NextResponse.json(shipment, { status: 201 });
}
