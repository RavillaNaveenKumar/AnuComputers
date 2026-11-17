import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateAuthorization } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authorization = await evaluateAuthorization({ capability: "settings:manage" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  return NextResponse.json(await prisma.businessSetting.findMany({ orderBy: { key: "asc" } }));
}

export async function PUT(request: Request) {
  const authorization = await evaluateAuthorization({ capability: "settings:manage" });
  if (!authorization.allowed) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const input = z.object({
    timezone: z.string().trim().min(1).max(80),
    defaultWarrantyMonths: z.coerce.number().int().min(0).max(1200),
  }).safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  await prisma.$transaction([
    prisma.businessSetting.upsert({ where: { key: "timezone" }, create: { key: "timezone", value: input.data.timezone }, update: { value: input.data.timezone } }),
    prisma.businessSetting.upsert({ where: { key: "defaultWarrantyMonths" }, create: { key: "defaultWarrantyMonths", value: String(input.data.defaultWarrantyMonths) }, update: { value: String(input.data.defaultWarrantyMonths) } }),
  ]);
  return NextResponse.json({ success: true });
}
