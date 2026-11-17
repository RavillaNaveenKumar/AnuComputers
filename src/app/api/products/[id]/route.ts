import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { deleteNativeRecordMetadata, writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const patchSchema = productSchema.extend({
  active: z.enum(["true", "false"]).optional().transform((value) => value === undefined ? undefined : value === "true"),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Product", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Product", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  const input = patchSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const fieldNames = ["ProductCode", "Name", "Description", "Brand", "Model", "ManufacturerPart", "Price", "TrackingType", "WarrantyMonths", "CategoryId", ...(input.data.active !== undefined ? ["Active"] : [])];
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Product", fieldNames, "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  if (input.data.categoryId && !await prisma.productCategory.findUnique({ where: { id: input.data.categoryId }, select: { id: true } })) {
    return NextResponse.json({ error: "Category not found." }, { status: 400 });
  }
  const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  const updated = await prisma.$transaction(async (tx) => {
    const record = await tx.product.update({ where: { id }, data: {
      sku: input.data.sku,
      name: input.data.name,
      description: input.data.description || null,
      brand: input.data.brand || null,
      model: input.data.model || null,
      manufacturerPart: input.data.manufacturerPart || null,
      unitPrice: input.data.unitPrice,
      trackingType: input.data.trackingType,
      warrantyMonths: input.data.warrantyMonths ?? 0,
      categoryId: input.data.categoryId || null,
      ...(input.data.active !== undefined ? { active: input.data.active } : {}),
    } });
    await writeNativeRecordMetadata(tx, "Product", id, user.id);
    return record;
  });
  await audit(user.id, "PRODUCT_UPDATED", "Product", id);
  return NextResponse.json({ success: true, id: updated.id });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Product", objectCapability: "canDelete" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Product", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, quoteItems: { select: { id: true }, take: 1 }, orderItems: { select: { id: true }, take: 1 }, units: { select: { id: true }, take: 1 } },
  });
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  if (product.quoteItems.length || product.orderItems.length || product.units.length) {
    return NextResponse.json({ error: "This product has quote, order, or warranty history. Deactivate it instead of deleting it." }, { status: 409 });
  }
  await prisma.$transaction(async (tx) => {
    await deleteNativeRecordMetadata(tx, "Product", id);
    await tx.product.delete({ where: { id } });
  });
  await audit(user.id, "PRODUCT_DELETED", "Product", id);
  return NextResponse.json({ success: true });
}
