import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const schema = z.object({
  label: z.enum(["Billing", "Shipping", "Other"]),
  line1: z.string().trim().min(1).max(160),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().min(1).max(80).default("India"),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Account", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const customer = await getNativeCrmRecord("Account", id, user, "edit");
  if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Account", ["AddressDetails"], "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const input = schema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const address = await prisma.$transaction(async (tx) => {
    const record = await tx.address.create({ data: { ...input.data, customerId: id, line2: input.data.line2 || null } });
    await writeNativeRecordMetadata(tx, "Account", id, user.id);
    return record;
  });
  return NextResponse.json({ success: true, id: address.id }, { status: 201 });
}
