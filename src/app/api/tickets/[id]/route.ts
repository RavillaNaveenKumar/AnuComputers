import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";
import { z } from "zod";

const schema = z.object({
  status: z.enum(["ASSIGNED", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assigneeId: z.string().nullable().optional(),
  waitingReason: z.string().max(500).nullable().optional(),
  resolutionNote: z.string().max(3000).nullable().optional(),
  diagnosis: z.string().max(3000).nullable().optional(),
  partsUsedNotes: z.string().max(2000).nullable().optional(),
  warrantyDecision: z.enum(["ACTIVE", "EXPIRED", "UNKNOWN", "APPROVED", "DECLINED"]).optional(),
  chargeable: z.boolean().optional(),
  customerApproved: z.boolean().optional(),
  handoverNotes: z.string().max(1000).optional(),
  note: z.string().trim().min(1).max(3000).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Case", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Case", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  const existing = await prisma.serviceTicket.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  const input = schema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const fieldNames: Record<string, string> = {
    status: "Status", priority: "Priority", assigneeId: "AssigneeId", waitingReason: "WaitingReason",
    resolutionNote: "ResolutionNote", diagnosis: "Diagnosis", partsUsedNotes: "PartsUsedNotes",
    warrantyDecision: "WarrantyDecision", chargeable: "Chargeable", customerApproved: "CustomerApproved",
    handoverNotes: "HandoverNotes",
  };
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Case", Object.keys(input.data).filter((key) => key !== "note" && input.data[key as keyof typeof input.data] !== undefined).map((key) => fieldNames[key]).filter(Boolean), "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  if (input.data.assigneeId !== undefined) {
    const assignmentAuthorization = await evaluateUserAuthorization(user, { capability: "service:assign" });
    if (!assignmentAuthorization.allowed) return NextResponse.json({ error: "You cannot assign tickets." }, { status: assignmentAuthorization.status });
  }
  if (input.data.assigneeId) {
    const assignee = await prisma.user.findUnique({ where: { id: input.data.assigneeId }, select: { role: true, active: true } });
    if (!assignee?.active || !["TECHNICIAN", "SERVICE_AGENT"].includes(assignee.role)) return NextResponse.json({ error: "Ticket assignee must be an active service agent or technician." }, { status: 400 });
  }
  if (input.data.status === "WAITING" && !input.data.waitingReason?.trim() && !existing.waitingReason) {
    return NextResponse.json({ error: "A waiting reason is required." }, { status: 400 });
  }
  if (input.data.status === "CLOSED" && !(input.data.resolutionNote || existing.resolutionNote)?.trim()) {
    return NextResponse.json({ error: "A resolution note is required before closing." }, { status: 400 });
  }
  if (input.data.status === "CLOSED" && existing.status !== "RESOLVED") {
    return NextResponse.json({ error: "Resolve the ticket before closing it." }, { status: 409 });
  }
  if (existing.status === "CLOSED") return NextResponse.json({ error: "Closed tickets cannot be changed." }, { status: 409 });
  const allowedTransitions: Record<string, string[]> = {
    NEW: ["ASSIGNED"],
    ASSIGNED: ["IN_PROGRESS", "WAITING"],
    IN_PROGRESS: ["WAITING", "RESOLVED"],
    WAITING: ["IN_PROGRESS", "RESOLVED"],
    RESOLVED: ["IN_PROGRESS", "CLOSED"],
    CLOSED: [],
  };
  if (input.data.status && input.data.status !== existing.status && !allowedTransitions[existing.status]?.includes(input.data.status)) {
    return NextResponse.json({ error: `Cannot move a ${existing.status.replaceAll("_", " ").toLowerCase()} ticket to ${input.data.status.replaceAll("_", " ").toLowerCase()}.` }, { status: 409 });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const ticket = await tx.serviceTicket.update({ where: { id }, data: {
      ...(input.data.status ? { status: input.data.status } : input.data.assigneeId && existing.status === "NEW" ? { status: "ASSIGNED" } : {}),
      ...(input.data.priority ? { priority: input.data.priority } : {}),
      ...(input.data.assigneeId !== undefined ? { assigneeId: input.data.assigneeId } : {}),
      ...(input.data.waitingReason !== undefined ? { waitingReason: input.data.waitingReason } : {}),
      ...(input.data.resolutionNote !== undefined ? { resolutionNote: input.data.resolutionNote } : {}),
      ...(input.data.diagnosis !== undefined ? { diagnosis: input.data.diagnosis } : {}),
      ...(input.data.partsUsedNotes !== undefined ? { partsUsedNotes: input.data.partsUsedNotes } : {}),
      ...(input.data.warrantyDecision ? { warrantyDecision: input.data.warrantyDecision } : {}),
      ...(input.data.chargeable !== undefined ? { chargeable: input.data.chargeable } : {}),
      ...(input.data.customerApproved !== undefined ? { customerApproved: input.data.customerApproved } : {}),
      ...(input.data.handoverNotes ? { handoverNotes: input.data.handoverNotes } : {}),
      ...(input.data.status === "CLOSED" ? { closedAt: new Date() } : {}),
    } });
    if (input.data.note) {
      const comment = await tx.ticketUpdate.create({ data: { ticketId: id, authorId: user.id, kind: "UPDATE", note: input.data.note } });
      await writeNativeRecordMetadata(tx, "CaseComment", comment.id, user.id, true);
    }
    await writeNativeRecordMetadata(tx, "Case", id, user.id);
    return ticket;
  });
  if (updated.status === "CLOSED") await audit(user.id, "TICKET_CLOSED", "ServiceTicket", id);
  if (input.data.assigneeId !== undefined && input.data.assigneeId !== existing.assigneeId) {
    await audit(user.id, "TICKET_ASSIGNED", "ServiceTicket", id, { assigneeId: input.data.assigneeId });
  }
  return NextResponse.json({ success: true, id: updated.id });
}
