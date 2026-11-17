import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { ticketSchema } from "@/lib/validators";
import { reference } from "@/lib/references";
import { audit } from "@/lib/audit";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";
import { getNativeCrmRecord } from "@/lib/native-crm-records";
import { writeNativeRecordMetadata } from "@/lib/native-crm-mutations";

export async function GET(request: Request) {
  const authorization = await evaluateAuthorization({ objectApiName: "Case", objectCapability: "canRead" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const [productAuthorization, accountAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
  ]);
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Case", [
    "CaseNumber", "AccountId", "OrderId", "UnitId", "Subject", "Description", "Type", "Priority", "Status",
    "WaitingReason", "Diagnosis", "PartsUsedNotes", "WarrantyDecision", "Chargeable", "CustomerApproved",
    "ResolutionNote", "HandoverNotes", "AssigneeId",
  ], "read");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  if (accountAuthorization.allowed) {
    const accountFields = await evaluateNativeFieldAuthorization(user, "Account", ["Name", "Phone"], "read");
    if (!accountFields.allowed) return NextResponse.json({ error: accountFields.error }, { status: accountFields.status });
  }
  if (productAuthorization.allowed) {
    const productFields = await evaluateNativeFieldAuthorization(user, "Product", ["Name", "ProductCode", "WarrantyMonths"], "read");
    if (!productFields.allowed) return NextResponse.json({ error: productFields.error }, { status: productFields.status });
  }
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const priority = params.get("priority");
  const [accessibleIds, productIds, accountIds] = await Promise.all([
    listNativeCrmRecordIds("Case", user),
    productAuthorization.allowed ? listNativeCrmRecordIds("Product", user) : Promise.resolve([]),
    accountAuthorization.allowed ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
  ]);
  const tickets = await prisma.serviceTicket.findMany({
    where: {
      id: { in: accessibleIds },
      ...(status ? { status: status as never } : {}),
      ...(priority ? { priority: priority as never } : {}),
    },
    include: { customer: { select: { id: true, name: true, phone: true } }, unit: { include: { product: { select: { id: true, name: true, sku: true, warrantyMonths: true } } } }, assignee: { select: { id: true, name: true } } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 100,
  });
  return NextResponse.json(tickets.map((ticket) => ({
    ...ticket,
    customer: accountIds.includes(ticket.customer.id) ? ticket.customer : { ...ticket.customer, name: "Restricted", phone: null },
    unit: ticket.unit && productIds.includes(ticket.unit.product.id) ? ticket.unit : null,
  })));
}

export async function POST(request: Request) {
  const authorization = await evaluateAuthorization({ objectApiName: "Case", objectCapability: "canCreate" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const input = ticketSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const fieldNames: Record<string, string> = {
    customerId: "AccountId", unitId: "UnitId", orderId: "OrderId", type: "Type", title: "Subject",
    description: "Description", priority: "Priority", assigneeId: "AssigneeId",
  };
  const fieldAuthorization = await evaluateNativeFieldAuthorization(user, "Case", Object.keys(input.data).map((field) => fieldNames[field]).filter(Boolean), "edit");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  const accountAuthorization = await evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" });
  if (!accountAuthorization.allowed) return NextResponse.json({ error: "You cannot access accounts." }, { status: accountAuthorization.status });
  if (input.data.orderId) {
    const orderAuthorization = await evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" });
    if (!orderAuthorization.allowed) return NextResponse.json({ error: "You cannot access orders." }, { status: orderAuthorization.status });
  }
  if (input.data.assigneeId) {
    const assignmentAuthorization = await evaluateUserAuthorization(user, { capability: "service:assign" });
    if (!assignmentAuthorization.allowed) return NextResponse.json({ error: "You cannot assign tickets." }, { status: assignmentAuthorization.status });
  }
  const [customer, unit, order, assignee] = await Promise.all([
    getNativeCrmRecord("Account", input.data.customerId, user)
      .then((record) => record ? prisma.customer.findUnique({ where: { id: input.data.customerId }, select: { id: true } }) : null),
    input.data.unitId ? prisma.purchasedUnit.findUnique({ where: { id: input.data.unitId }, select: { id: true, customerId: true, orderItem: { select: { orderId: true } } } }) : Promise.resolve(null),
    input.data.orderId
      ? getNativeCrmRecord("Order", input.data.orderId, user).then((record) => record
        ? prisma.order.findUnique({ where: { id: input.data.orderId! }, select: { id: true, customerId: true } })
        : null)
      : Promise.resolve(null),
    input.data.assigneeId ? prisma.user.findUnique({ where: { id: input.data.assigneeId }, select: { id: true, role: true, active: true } }) : Promise.resolve(null),
  ]);
  if (!customer || (input.data.unitId && (!unit || unit.customerId !== customer.id)) ||
      (input.data.orderId && (!order || order.customerId !== customer.id)) ||
      (unit && order && unit.orderItem && unit.orderItem.orderId !== order.id) ||
      (input.data.assigneeId && (!assignee?.active || !["TECHNICIAN", "SERVICE_AGENT"].includes(assignee.role)))) {
    return NextResponse.json({ error: "Customer, purchase, order, or assignee relationship is invalid." }, { status: 400 });
  }
  const ticket = await prisma.$transaction(async (tx) => {
    const record = await tx.serviceTicket.create({ data: {
      reference: reference("TKT"),
      customerId: customer.id,
      unitId: input.data.unitId || null,
      orderId: input.data.orderId || null,
      type: input.data.type,
      title: input.data.title,
      description: input.data.description,
      priority: input.data.priority,
      assigneeId: input.data.assigneeId || null,
      updates: { create: { authorId: user.id, kind: "CREATED", note: "Ticket opened" } },
    }, include: { customer: true, unit: true, updates: { select: { id: true } } } });
    await writeNativeRecordMetadata(tx, "Case", record.id, user.id, true);
    for (const comment of record.updates) await writeNativeRecordMetadata(tx, "CaseComment", comment.id, user.id, true);
    return record;
  });
  await audit(user.id, "TICKET_CREATED", "ServiceTicket", ticket.id);
  return NextResponse.json({ success: true, id: ticket.id }, { status: 201 });
}
