import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { customerSchema } from "@/lib/validators";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), customerId: z.string().min(1) }),
  z.object({ mode: z.literal("new"), customer: customerSchema }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Lead", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Lead", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  const input = schema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const leadFields = await evaluateNativeFieldAuthorization(user, "Lead", ["Status", "AccountId"], "edit");
  if (!leadFields.allowed) return NextResponse.json({ error: leadFields.error }, { status: leadFields.status });
  if (input.data.mode === "existing") {
    const accountAuthorization = await evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" });
    if (!accountAuthorization.allowed) return NextResponse.json({ error: "You cannot access accounts." }, { status: accountAuthorization.status });
  }
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  if (lead.status !== "QUALIFIED") return NextResponse.json({ error: "Only qualified leads can be converted." }, { status: 409 });
  if (input.data.mode === "new") {
    const accountAuthorization = await evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canCreate" });
    if (!accountAuthorization.allowed) return NextResponse.json({ error: "You cannot create an account." }, { status: accountAuthorization.status });
    const accountFieldNames: Record<string, string> = {
      name: "Name", kind: "Type", email: "Email", phone: "Phone", taxId: "TaxId", notes: "Notes",
    };
    const accountFields = await evaluateNativeFieldAuthorization(user, "Account", [
      ...Object.keys(input.data.customer).map((field) => accountFieldNames[field]).filter(Boolean),
    ], "edit");
    if (!accountFields.allowed) return NextResponse.json({ error: accountFields.error }, { status: accountFields.status });
  }
  const accessibleCustomer = input.data.mode === "existing"
    ? await getNativeCrmRecord("Account", input.data.customerId, user)
    : null;
  if (input.data.mode === "existing" && !accessibleCustomer) return NextResponse.json({ error: "Customer not found." }, { status: 400 });
  const existingCustomer = input.data.mode === "existing"
    ? await prisma.customer.findUnique({ where: { id: input.data.customerId } })
    : null;
  if (input.data.mode === "existing" && !existingCustomer) return NextResponse.json({ error: "Customer not found." }, { status: 400 });
  if (user.role === "SALES_EXECUTIVE" && input.data.mode === "existing" && existingCustomer?.ownerId && existingCustomer.ownerId !== user.id) {
    return NextResponse.json({ error: "You can only convert a lead to a customer assigned to you." }, { status: 403 });
  }
  const conversion = await prisma.$transaction(async (tx) => {
    let customer = existingCustomer;
    if (!customer && input.data.mode === "new") {
      customer = await tx.customer.create({ data: {
        ...input.data.customer,
        email: input.data.customer.email || lead.email || null,
        phone: input.data.customer.phone || lead.phone || null,
        taxId: input.data.customer.taxId || null,
        notes: input.data.customer.notes || null,
      } });
      await writeNativeRecordMetadata(tx, "Account", customer.id, user.id, true);
    }
    if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
    if (input.data.mode === "new" || !customer.ownerId) {
      customer = await tx.customer.update({ where: { id: customer.id }, data: { ownerId: lead.assigneeId || user.id } });
      await writeNativeRecordMetadata(tx, "Account", customer.id, user.id);
    }
    // The conditional update makes conversion single-writer. If two requests race,
    // the losing transaction rolls back its newly created customer as well.
    const transition = await tx.lead.updateMany({
      where: { id, status: "QUALIFIED" },
      data: { status: "CONVERTED", customerId: customer.id },
    });
    if (transition.count !== 1) throw new Error("ALREADY_CONVERTED");
    const updatedLead = await tx.lead.findUniqueOrThrow({ where: { id } });
    await tx.leadActivity.create({ data: { leadId: id, authorId: user.id, kind: "CONVERTED", note: `Lead converted to customer ${customer.name}` } });
    await writeNativeRecordMetadata(tx, "Lead", id, user.id);
    return { customer, lead: updatedLead };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "ALREADY_CONVERTED") return null;
    throw error;
  });
  if (!conversion) return NextResponse.json({ error: "This lead has already been converted." }, { status: 409 });
  const { customer, lead: result } = conversion;
  await audit(user.id, "LEAD_CONVERTED", "Lead", id, { customerId: customer.id });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath(`/customers/${customer.id}`);
  return NextResponse.json({ success: true, leadId: result.id, customerId: customer.id });
}
