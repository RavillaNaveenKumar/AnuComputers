import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCrmAdmin } from "@/lib/crm-setup-api";

export async function GET() {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const [roles, users] = await Promise.all([
    prisma.crmHierarchyRole.findMany({
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        builtIn: true,
        parentId: true,
        _count: { select: { children: true, userAssignments: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        hierarchyRoleId: true,
        hierarchyRole: { select: { id: true, name: true } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  ]);
  return NextResponse.json({ roles, users });
}
