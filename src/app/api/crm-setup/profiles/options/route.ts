import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCrmAdmin } from "@/lib/crm-setup-api";

export async function GET() {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const profiles = await prisma.crmProfile.findMany({
    select: { id: true, name: true, allowLogin: true },
    orderBy: [{ builtIn: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ profiles });
}
