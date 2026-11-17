import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { deleteNativeRecordMetadata, writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().or(z.literal("")).optional(),
  phone: z.string().trim().max(40).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  interest: z.string().trim().max(200).nullable().optional(),
  estimatedQuantity: z.coerce.number().int().min(1).max(100000).optional(),
  status: z.enum(["NEW", "ASSIGNED", "CONTACTED", "QUALIFIED", "NURTURE", "DISQUALIFIED", "CONVERTED"]).optional(),
  assigneeId: z.string().nullable().optional(),
  nextFollowUpAt: z.preprocess((value) => value === "" ? null : value, z.coerce.date().nullable().optional()),
  customerId: z.string().nullable().optional(),
  notes: z.string().max(3000).nullable().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Lead", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Lead", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const fieldNames: Record<string, string> = {
    name: "Name", email: "Email", phone: "Phone", source: "Source", interest: "Interest",
    estimatedQuantity: "EstimatedQuantity", status: "Status", assigneeId: "AssigneeId",
    nextFollowUpAt: "NextFollowUpAt", customerId: "AccountId", notes: "Notes",
  };
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Lead", [
    ...Object.keys(parsed.data).map((key) => fieldNames[key]).filter(Boolean),
    "ActivityKind",
    "ActivityNote",
  ], "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  if (parsed.data.status === "CONVERTED") return NextResponse.json({ error: "Use the conversion workflow to mark a lead as converted." }, { status: 409 });
  const allowedTransitions: Record<string, string[]> = {
    NEW: ["ASSIGNED", "CONTACTED", "NURTURE", "DISQUALIFIED"],
    ASSIGNED: ["CONTACTED", "QUALIFIED", "NURTURE", "DISQUALIFIED"],
    CONTACTED: ["QUALIFIED", "NURTURE", "DISQUALIFIED"],
    QUALIFIED: ["NURTURE", "DISQUALIFIED"],
    NURTURE: ["CONTACTED", "QUALIFIED", "DISQUALIFIED"],
    DISQUALIFIED: [],
    CONVERTED: [],
  };
  if (parsed.data.status && parsed.data.status !== existing.status && !allowedTransitions[existing.status]?.includes(parsed.data.status)) {
    return NextResponse.json({ error: `Cannot move a ${existing.status.toLowerCase()} lead to ${parsed.data.status.toLowerCase()}.` }, { status: 409 });
  }
  if (parsed.data.assigneeId !== undefined) {
    const assignmentAuthorization = await evaluateUserAuthorization(user, { capability: "leads:assign" });
    if (!assignmentAuthorization.allowed) return NextResponse.json({ error: "You cannot reassign leads." }, { status: assignmentAuthorization.status });
  }
  if (parsed.data.customerId && !await getNativeCrmRecord("Account", parsed.data.customerId, user)) {
    return NextResponse.json({ error: "Customer not found" }, { status: 400 });
  }
  const lead = await prisma.$transaction(async (tx) => {
    const record = await tx.lead.update({ where: { id }, data: {
      ...parsed.data,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      interest: parsed.data.interest || null,
      notes: parsed.data.notes || null,
      ...(parsed.data.assigneeId && existing.status === "NEW" && !parsed.data.status ? { status: "ASSIGNED" } : {}),
      activities: { create: { authorId: user.id, kind: "UPDATED", note: "Lead details updated" } },
    } });
    await writeNativeRecordMetadata(tx, "Lead", id, user.id);
    return record;
  });
  await audit(user.id, "LEAD_UPDATED", "Lead", id);
  if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== existing.assigneeId) {
    await prisma.auditEvent.create({ data: { actorId: user.id, action: "LEAD_ASSIGNED", entityType: "Lead", entityId: id, metadata: { assigneeId: parsed.data.assigneeId } } });
  }
  return NextResponse.json({ success: true, id: lead.id });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Lead", objectCapability: "canDelete" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Lead", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, status: true, assigneeId: true, activities: { select: { id: true }, take: 1 } },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  if (lead.status === "CONVERTED" || lead.activities.length) {
    return NextResponse.json({ error: "This lead has conversion or activity history. Keep it and update its status instead of deleting it." }, { status: 409 });
  }
  await prisma.$transaction(async (tx) => {
    await deleteNativeRecordMetadata(tx, "Lead", id);
    await tx.lead.delete({ where: { id } });
  });
  await audit(user.id, "LEAD_DELETED", "Lead", id);
  return NextResponse.json({ success: true });
}
