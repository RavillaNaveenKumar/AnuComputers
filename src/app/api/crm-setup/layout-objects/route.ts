import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCrmAdmin } from "@/lib/crm-setup-api";

export async function GET() {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const objects = await prisma.crmObject.findMany({
    where: { active: true },
    select: { id: true, pluralLabel: true },
    orderBy: [{ module: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(objects);
}
