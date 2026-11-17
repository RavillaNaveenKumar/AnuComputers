import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validators";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

export async function GET(request: Request) {
  const authorization = await evaluateAuthorization({ objectApiName: "Product", objectCapability: "canRead" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Product", ["ProductCode", "Name", "Brand", "Model", "ManufacturerPart", "TrackingType", "WarrantyMonths", "CategoryId"], "read");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const priceAuthorization = await evaluateNativeFieldAuthorization(user, "Product", ["Price"], "read");
  const accessibleIds = await listNativeCrmRecordIds("Product", user);
  const q = new URL(request.url).searchParams.get("q")?.trim();
  const products = await prisma.product.findMany({
    where: { id: { in: accessibleIds }, active: true, ...(q ? { OR: [
      { sku: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
      { manufacturerPart: { contains: q, mode: "insensitive" } },
    ] } : {}) },
    select: { id: true, sku: true, name: true, brand: true, model: true, ...(priceAuthorization.allowed ? { unitPrice: true } : {}), trackingType: true, warrantyMonths: true, category: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 100,
  });
  return NextResponse.json(products);
}

export async function POST(request: Request) {
  const authorization = await evaluateAuthorization({ objectApiName: "Product", objectCapability: "canCreate" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const input = productSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const submittedFields: Record<string, string> = {
    sku: "ProductCode", name: "Name", description: "Description", brand: "Brand", model: "Model",
    manufacturerPart: "ManufacturerPart", unitPrice: "Price", trackingType: "TrackingType",
    warrantyMonths: "WarrantyMonths", categoryId: "CategoryId",
  };
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Product", Object.keys(input.data).map((field) => submittedFields[field]).filter(Boolean), "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  if (input.data.categoryId && !await prisma.productCategory.findUnique({ where: { id: input.data.categoryId }, select: { id: true } })) {
    return NextResponse.json({ error: "Category not found." }, { status: 400 });
  }
  const warrantyDefault = await prisma.businessSetting.findUnique({ where: { key: "defaultWarrantyMonths" }, select: { value: true } });
  const product = await prisma.$transaction(async (tx) => {
    const record = await tx.product.create({ data: {
      ...input.data,
      categoryId: input.data.categoryId || null,
      warrantyMonths: input.data.warrantyMonths ?? Number(warrantyDefault?.value || 0),
      manufacturerPart: input.data.manufacturerPart || null,
      brand: input.data.brand || null,
      model: input.data.model || null,
    } });
    await writeNativeRecordMetadata(tx, "Product", record.id, user.id, true);
    return record;
  });
  return NextResponse.json({ success: true, id: product.id }, { status: 201 });
}
