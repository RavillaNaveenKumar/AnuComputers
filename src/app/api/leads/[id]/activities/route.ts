import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

const activitySchema = z.object({
  kind: z.enum(["CALL", "EMAIL", "MEETING", "NOTE", "FOLLOW_UP"]),
  note: z.string().trim().min(1).max(3000),
  status: z.enum(["NEW", "ASSIGNED", "CONTACTED", "QUALIFIED", "NURTURE", "DISQUALIFIED"]).optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await evaluateAuthorization({ objectApiName: "Lead", objectCapability: "canEdit" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const { id } = await context.params;
  const accessible = await getNativeCrmRecord("Lead", id, user, "edit");
  if (!accessible) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, assigneeId: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const input = activitySchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const fieldNames = [
    "ActivityKind",
    "ActivityNote",
    ...(input.data.status !== undefined ? ["Status"] : []),
    ...(input.data.nextFollowUpAt !== undefined ? ["NextFollowUpAt"] : []),
  ];
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Lead", fieldNames, "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  if (input.data.status) {
    const transitions: Record<string, string[]> = {
      NEW: ["ASSIGNED", "CONTACTED", "NURTURE", "DISQUALIFIED"],
      ASSIGNED: ["CONTACTED", "QUALIFIED", "NURTURE", "DISQUALIFIED"],
      CONTACTED: ["QUALIFIED", "NURTURE", "DISQUALIFIED"],
      QUALIFIED: ["NURTURE", "DISQUALIFIED"],
      NURTURE: ["CONTACTED", "QUALIFIED", "DISQUALIFIED"],
      DISQUALIFIED: [],
      CONVERTED: [],
    };
    const current = await prisma.lead.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (input.data.status !== current.status && !transitions[current.status]?.includes(input.data.status)) {
      return NextResponse.json({ error: `Cannot move a ${current.status.toLowerCase()} lead to ${input.data.status.toLowerCase()}.` }, { status: 409 });
    }
  }
  const activity = await prisma.$transaction(async (tx) => {
    const created = await tx.leadActivity.create({ data: { leadId: id, authorId: user.id, kind: input.data.kind, note: input.data.note } });
    await tx.lead.update({ where: { id }, data: {
      ...(input.data.status ? { status: input.data.status } : {}),
      ...(input.data.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.data.nextFollowUpAt } : {}),
    } });
    await writeNativeRecordMetadata(tx, "Lead", id, user.id);
    return created;
  });
  return NextResponse.json({ success: true, id: activity.id }, { status: 201 });
}
