import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";

const assignmentSchema = z.object({
  userId: z.string().min(1),
  hierarchyRoleId: z.string().min(1).nullable(),
});

export async function PUT(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = assignmentSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const [user, role] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.data.userId },
      select: { id: true, hierarchyRoleId: true },
    }),
    input.data.hierarchyRoleId
      ? prisma.crmHierarchyRole.findUnique({
        where: { id: input.data.hierarchyRoleId },
        select: { id: true, name: true },
      })
      : Promise.resolve(null),
  ]);
  if (!user) return NextResponse.json({ error: "The selected user does not exist." }, { status: 404 });
  if (input.data.hierarchyRoleId && !role) return NextResponse.json({ error: "The selected hierarchy role does not exist." }, { status: 404 });
  if (user.hierarchyRoleId === input.data.hierarchyRoleId) return NextResponse.json({ success: true });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { hierarchyRoleId: input.data.hierarchyRoleId },
    });
    await auditCrmChange(tx, admin.user.id, "USER_HIERARCHY_ROLE_UPDATED", "User", user.id, {
      previousRoleId: user.hierarchyRoleId,
      hierarchyRoleId: role?.id ?? null,
      hierarchyRoleName: role?.name ?? null,
    });
  });
  return NextResponse.json({ success: true, hierarchyRoleId: role?.id ?? null });
}
