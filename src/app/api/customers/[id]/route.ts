import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { customerSchema } from "@/lib/validators";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Account", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const customer = await getNativeCrmRecord("Account", id, user, "edit");
  if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const input = customerSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Account", ["Name", "Type", "Phone", "Email", "TaxId", "Notes"], "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const updated = await prisma.$transaction(async (tx) => {
    const record = await tx.customer.update({ where: { id }, data: {
      ...input.data,
      email: input.data.email || null,
      phone: input.data.phone || null,
      taxId: input.data.taxId || null,
      notes: input.data.notes || null,
    } });
    await writeNativeRecordMetadata(tx, "Account", id, user.id);
    return record;
  });
  return NextResponse.json({ success: true, id: updated.id });
}
