import { NextResponse } from "next/server";
import { evaluateAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authorization = await evaluateAuthorization({ capability: "staff:manage" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const staff = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(staff);
}

export async function POST() {
  const authorization = await evaluateAuthorization({ capability: "staff:manage" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  return NextResponse.json({ error: "Staff management moved to CRM Setup → Users." }, { status: 410 });
}

export async function PATCH() {
  const authorization = await evaluateAuthorization({ capability: "staff:manage" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  return NextResponse.json({ error: "Staff management moved to CRM Setup → Users." }, { status: 410 });
}
