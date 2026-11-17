import { NextResponse } from "next/server";
import { evaluateAuthorization, evaluateNativeFieldAuthorization, evaluateUserAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { listNativeCrmRecordIds } from "@/lib/native-crm-records";

export async function GET(request: Request) {
  const authorization = await evaluateAuthorization();
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { user } = authorization;
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ customers: [], leads: [], orders: [], serials: [] });
  const [accountAuthorization, leadAuthorization, orderAuthorization, caseAuthorization, productAuthorization] = await Promise.all([
    evaluateUserAuthorization(user, { objectApiName: "Account", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Lead", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Order", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Case", objectCapability: "canRead" }),
    evaluateUserAuthorization(user, { objectApiName: "Product", objectCapability: "canRead" }),
  ]);
  const fieldChecks = await Promise.all([
    accountAuthorization.allowed
      ? evaluateNativeFieldAuthorization(user, "Account", ["Name", "Phone", "Email"], "read")
      : Promise.resolve({ allowed: true as const }),
    leadAuthorization.allowed
      ? evaluateNativeFieldAuthorization(user, "Lead", ["Reference", "Name", "Phone", "Status"], "read")
      : Promise.resolve({ allowed: true as const }),
    orderAuthorization.allowed
      ? evaluateNativeFieldAuthorization(user, "Order", ["Name", "InvoiceReference", "Status"], "read")
      : Promise.resolve({ allowed: true as const }),
    caseAuthorization.allowed
      ? evaluateNativeFieldAuthorization(user, "Case", ["UnitId"], "read")
      : Promise.resolve({ allowed: true as const }),
    productAuthorization.allowed
      ? evaluateNativeFieldAuthorization(user, "Product", ["Name"], "read")
      : Promise.resolve({ allowed: true as const }),
  ]);
  const deniedFields = fieldChecks.find((result) => !result.allowed);
  if (deniedFields && !deniedFields.allowed) {
    return NextResponse.json({ error: deniedFields.error }, { status: deniedFields.status });
  }
  const [accountIds, leadIds, orderIds, productIds] = await Promise.all([
    accountAuthorization.allowed ? listNativeCrmRecordIds("Account", user) : Promise.resolve([]),
    leadAuthorization.allowed ? listNativeCrmRecordIds("Lead", user) : Promise.resolve([]),
    orderAuthorization.allowed ? listNativeCrmRecordIds("Order", user) : Promise.resolve([]),
    productAuthorization.allowed ? listNativeCrmRecordIds("Product", user) : Promise.resolve([]),
  ]);
  const [customers, leads, orders, serials] = await Promise.all([
    accountAuthorization.allowed ? prisma.customer.findMany({
      where: { AND: [{ id: { in: accountIds } }, { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" } }] }] },
      select: { id: true, name: true, phone: true, email: true }, take: 8,
    }) : Promise.resolve([]),
    leadAuthorization.allowed ? prisma.lead.findMany({
      where: { id: { in: leadIds }, OR: [{ reference: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] },
      select: { id: true, reference: true, name: true, status: true }, take: 8,
    }) : Promise.resolve([]),
    orderAuthorization.allowed ? prisma.order.findMany({
      where: { AND: [{ id: { in: orderIds } }, { OR: [{ reference: { contains: q, mode: "insensitive" } }, { invoiceReference: { contains: q, mode: "insensitive" } }] }] },
      select: { id: true, reference: true, status: true, customer: { select: { name: true } } }, take: 8,
    }) : Promise.resolve([]),
    caseAuthorization.allowed ? prisma.purchasedUnit.findMany({
      where: { customerId: { in: accountIds }, productId: { in: productIds }, normalizedSerial: { contains: q.replace(/\s+/g, "").toUpperCase() } },
      select: { id: true, serial: true, product: { select: { name: true } }, customer: { select: { id: true, name: true } } }, take: 8,
    }) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    customers,
    leads,
    orders: orders.map((order) => ({
      ...order,
      customer: accountAuthorization.allowed ? order.customer : { name: "Restricted" },
    })),
    serials,
  });
}
