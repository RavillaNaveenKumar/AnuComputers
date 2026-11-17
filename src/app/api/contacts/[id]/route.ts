import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { deleteNativeRecordMetadata, writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const contactSchema = z.object({
  customerId: z.string().min(1),
  name: z.string().trim().max(120).optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().email().or(z.literal("")).optional(),
  phone: z.string().trim().max(40).optional(),
  title: z.string().trim().max(100).optional(),
  primary: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
}).refine((value) => value.name || value.lastName, { message: "Last name is required." });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Contact", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const existing = await getNativeCrmRecord("Contact", id, user, "edit");
  if (!existing) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  const input = contactSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Contact", ["AccountId", "FirstName", "LastName", "Email", "Phone", "Title", "Primary"], "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const accountAuthorization = await evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" });
  if (!accountAuthorization.allowed) return NextResponse.json({ error: "You cannot access accounts." }, { status: accountAuthorization.status });
  const customer = await getNativeCrmRecord("Account", input.data.customerId, user);
  if (!customer) return NextResponse.json({ error: "Account not found." }, { status: 400 });
  const firstName = input.data.firstName || null;
  const lastName = input.data.lastName || input.data.name!;
  const updated = await prisma.$transaction(async (tx) => {
    const isPrimary = input.data.primary === true || input.data.primary === "true";
    if (isPrimary) {
      const demoted = await tx.contact.findMany({ where: { customerId: input.data.customerId, primary: true, id: { not: id } }, select: { id: true } });
      await tx.contact.updateMany({ where: { id: { in: demoted.map(({ id: contactId }) => contactId) } }, data: { primary: false } });
      for (const record of demoted) await writeNativeRecordMetadata(tx, "Contact", record.id, user.id);
    }
    const record = await tx.contact.update({
      where: { id },
      data: {
        customerId: input.data.customerId,
        name: [firstName, lastName].filter(Boolean).join(" "),
        firstName,
        lastName,
        email: input.data.email || null,
        phone: input.data.phone || null,
        title: input.data.title || null,
        primary: isPrimary,
      },
    });
    await writeNativeRecordMetadata(tx, "Contact", id, user.id);
    return record;
  });
  await audit(user.id, "CONTACT_UPDATED", "Contact", id);
  return NextResponse.json({ success: true, id: updated.id });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Contact", objectCapability: "canDelete" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const existing = await getNativeCrmRecord("Contact", id, user, "edit");
  if (!existing) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await deleteNativeRecordMetadata(tx, "Contact", id);
    await tx.contact.delete({ where: { id } });
  });
  await audit(user.id, "CONTACT_DELETED", "Contact", id);
  return NextResponse.json({ success: true });
}
