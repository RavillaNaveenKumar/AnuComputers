import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { leadSchema } from "@/lib/validators";
import { reference } from "@/lib/references";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

export async function GET(request: Request) {
  const authorization = await evaluateAuthorization({
    capability: "leads:read",
    objectApiName: "Lead",
    objectCapability: "canRead",
  });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Lead", ["Name", "Reference", "Email", "Phone", "Status", "Source", "Interest", "EstimatedQuantity", "NextFollowUpAt", "Notes", "ActivityKind", "ActivityNote", "AccountId", "AssigneeId"], "read");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim();
  const status = params.get("status");
  const mine = params.get("mine") === "true";
  const accessibleIds = await listNativeCrmRecordIds("Lead", user);
  const leads = await prisma.lead.findMany({
    where: {
      id: { in: accessibleIds },
      ...(mine ? { assigneeId: user.id } : {}),
      ...(status ? { status: status as never } : {}),
      ...(q ? { OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
        { reference: { contains: q, mode: "insensitive" } },
      ] } : {}),
    },
    include: { assignee: { select: { id: true, name: true } }, activities: { orderBy: { createdAt: "desc" }, take: 3 } },
    orderBy: [{ nextFollowUpAt: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
  return NextResponse.json(leads);
}

export async function POST(request: Request) {
  const authorization = await evaluateAuthorization({
    capability: "leads:write",
    objectApiName: "Lead",
    objectCapability: "canCreate",
  });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const input = leadSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const fieldNames: Record<string, string> = {
    name: "Name", email: "Email", phone: "Phone", source: "Source", interest: "Interest",
    estimatedQuantity: "EstimatedQuantity", nextFollowUpAt: "NextFollowUpAt", notes: "Notes",
  };
  const fieldsToEdit = [...Object.keys(input.data).map((field) => fieldNames[field]).filter(Boolean), "AssigneeId", "ActivityKind", "ActivityNote"];
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Lead", fieldsToEdit, "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const assignmentAuthorization = await evaluateUserAuthorization(user, { capability: "leads:assign" });
  const canAssign = assignmentAuthorization.allowed;
  if (input.data.assigneeId && !canAssign && input.data.assigneeId !== user.id) {
    return NextResponse.json({ error: "You cannot assign leads to another staff member." }, { status: 403 });
  }
  const lead = await prisma.$transaction(async (tx) => {
    const record = await tx.lead.create({ data: {
      ...input.data,
      reference: reference("LEAD"),
      email: input.data.email || null,
      phone: input.data.phone || null,
      interest: input.data.interest || null,
      notes: input.data.notes || null,
      assigneeId: canAssign ? input.data.assigneeId || null : user.id,
      status: input.data.assigneeId || !canAssign ? "ASSIGNED" : "NEW",
      activities: { create: { authorId: user.id, kind: "CREATED", note: "Lead created" } },
    } });
    await writeNativeRecordMetadata(tx, "Lead", record.id, user.id, true);
    return record;
  });
  return NextResponse.json({ success: true, id: lead.id }, { status: 201 });
}
