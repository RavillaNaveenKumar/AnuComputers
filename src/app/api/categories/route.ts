import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateAuthorization, evaluateNativeFieldAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authorization = await evaluateAuthorization({ objectApiName: "Product", objectCapability: "canRead" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const fieldAuthorization = await evaluateNativeFieldAuthorization(authorization.user, "Product", ["CategoryId"], "read");
  if (!fieldAuthorization.allowed) return NextResponse.json({ error: fieldAuthorization.error }, { status: fieldAuthorization.status });
  return NextResponse.json(await prisma.productCategory.findMany({ orderBy: { name: "asc" } }));
}

export async function POST(request: Request) {
  const authorization = await evaluateAuthorization({ capability: "settings:manage" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const input = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  return NextResponse.json(await prisma.productCategory.create({ data: input.data }), { status: 201 });
}
