import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { customerSchema } from "@/lib/validators";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

export async function GET(request: Request) {
  const authorization = await evaluateAuthorization({ objectApiName: "Account", objectCapability: "canRead" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Account", ["Name", "Type", "Email", "Phone"], "read");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const accessibleIds = await listNativeCrmRecordIds("Account", user);
  const query = new URL(request.url).searchParams.get("q")?.trim();
  const customers = await prisma.customer.findMany({
    where: { AND: [
      { id: { in: accessibleIds } },
      ...(query ? [{ OR: [
        { name: { contains: query, mode: "insensitive" as const } },
        { phone: { contains: query } },
        { email: { contains: query, mode: "insensitive" as const } },
      ] }] : []),
    ] },
    select: { id: true, name: true, kind: true, email: user.role === "DISPATCH" ? false : true, phone: true, createdAt: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  return NextResponse.json(customers);
}

export async function POST(request: Request) {
  const authorization = await evaluateAuthorization({ objectApiName: "Account", objectCapability: "canCreate" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const input = customerSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Account", ["Name", "Type", "Phone", "Email", "TaxId", "Notes"], "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const customer = await prisma.$transaction(async (tx) => {
    const record = await tx.customer.create({ data: {
      ...input.data,
      ownerId: user.role === "SALES_EXECUTIVE" ? user.id : null,
      email: input.data.email || null,
      phone: input.data.phone || null,
      taxId: input.data.taxId || null,
      notes: input.data.notes || null,
    } });
    await writeNativeRecordMetadata(tx, "Account", record.id, user.id, true);
    return record;
  });
  return NextResponse.json({ success: true, id: customer.id }, { status: 201 });
}
