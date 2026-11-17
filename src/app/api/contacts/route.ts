import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const schema = z.object({
  customerId: z.string().min(1),
  name: z.string().trim().max(120).optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  title: z.string().trim().max(80).optional(),
  primary: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
}).refine((value) => value.name || value.lastName, { message: "Last name is required." });

export async function POST(request: Request) {
  const authorization = await evaluateAuthorization({ objectApiName: "Contact", objectCapability: "canCreate" });
  if (!authorization.allowed) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }
  const { user } = authorization;
  const accountAuthorization = await evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" });
  if (!accountAuthorization.allowed) return NextResponse.json({ error: "You cannot access accounts." }, { status: accountAuthorization.status });
  const input = schema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message ?? "Contact details are invalid." }, { status: 400 });
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Contact", ["FirstName", "LastName", "AccountId", "Email", "Phone", "Title", "Primary"], "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const customer = await getNativeCrmRecord("Account", input.data.customerId, user);
  if (!customer) return NextResponse.json({ error: "Select an account you can access." }, { status: 404 });
  const firstName = input.data.firstName || null;
  const lastName = input.data.lastName || input.data.name!;
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const contact = await prisma.$transaction(async (tx) => {
    if (input.data.primary) {
      const demoted = await tx.contact.findMany({ where: { customerId: customer.id, primary: true }, select: { id: true } });
      await tx.contact.updateMany({ where: { id: { in: demoted.map(({ id }) => id) } }, data: { primary: false } });
      for (const record of demoted) await writeNativeRecordMetadata(tx, "Contact", record.id, user.id);
    }
    const created = await tx.contact.create({ data: {
      customerId: customer.id,
      name,
      firstName,
      lastName,
      email: input.data.email || null,
      phone: input.data.phone || null,
      title: input.data.title || null,
      primary: input.data.primary,
    } });
    await writeNativeRecordMetadata(tx, "Contact", created.id, user.id, true);
    return created;
  });
  return NextResponse.json({ success: true, id: contact.id }, { status: 201 });
}
