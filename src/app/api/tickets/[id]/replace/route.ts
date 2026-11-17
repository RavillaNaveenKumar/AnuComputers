import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { normalizeSerial } from "@/lib/references";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const schema = z.object({
  productId: z.string().min(1),
  serial: z.string().trim().min(1).max(120),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Case", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Case", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  const input = schema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const [caseFields, productFields] = await Promise.all([
    evaluateNativeFieldAuthorization(user, "Case", ["UnitId"], "edit"),
    evaluateNativeFieldAuthorization(user, "Product", ["ProductCode", "Name", "WarrantyMonths", "TrackingType"], "read"),
  ]);
  for (const result of [caseFields, productFields]) {
    if (!result.allowed) return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const productAuthorization = await evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" });
  if (!productAuthorization.allowed) return NextResponse.json({ error: "You cannot access products." }, { status: productAuthorization.status });
  const ticket = await prisma.serviceTicket.findUnique({ where: { id }, include: { unit: { include: { replacement: true } } } });
  if (!ticket || !ticket.unit) return NextResponse.json({ error: "A ticket linked to a purchased unit is required." }, { status: 400 });
  if (ticket.unit.replacement) return NextResponse.json({ error: "This unit already has a registered replacement." }, { status: 409 });
  const product = await getNativeCrmRecord("Product", input.data.productId, user)
    ? await prisma.product.findUnique({ where: { id: input.data.productId } })
    : null;
  if (!product?.active || product.trackingType !== "SERIAL") return NextResponse.json({ error: "Choose an active serial-tracked product." }, { status: 400 });
  const normalizedSerial = normalizeSerial(input.data.serial);
  const now = new Date();
  const warrantyEnd = new Date(now);
  warrantyEnd.setMonth(warrantyEnd.getMonth() + product.warrantyMonths);
  try {
    const unit = await prisma.$transaction(async (tx) => {
      const created = await tx.purchasedUnit.create({ data: {
        customerId: ticket.customerId,
        productId: product.id,
        orderItemId: ticket.unit!.orderItemId,
        serial: input.data.serial,
        normalizedSerial,
        warrantyStart: now,
        warrantyEnd: product.warrantyMonths ? warrantyEnd : null,
        replacedUnitId: ticket.unit!.id,
      } });
      await tx.serviceTicket.update({ where: { id }, data: { unitId: created.id } });
      await writeNativeRecordMetadata(tx, "Case", id, user.id);
      const comment = await tx.ticketUpdate.create({ data: {
        ticketId: id,
        authorId: user.id,
        kind: "REPLACEMENT",
        note: `Unit ${ticket.unit!.serial} replaced with ${created.serial}`,
      } });
      await writeNativeRecordMetadata(tx, "CaseComment", comment.id, user.id, true);
      return created;
    });
    await audit(user.id, "UNIT_REPLACED", "ServiceTicket", id, { oldSerial: ticket.unit.serial, newSerial: unit.serial });
    return NextResponse.json(unit, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "That serial number is already registered for this product." }, { status: 409 });
    }
    throw error;
  }
}
