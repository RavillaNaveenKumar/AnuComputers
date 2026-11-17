import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const { id } = await context.params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, active: true },
  });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (!user.active) return NextResponse.json({ error: "Activate this account before sending a reset link." }, { status: 409 });

  try {
    await auth.api.requestPasswordReset({
      body: {
        email: user.email,
        redirectTo: `${(process.env.APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/+$/, "")}/reset-password`,
      },
      headers: await headers(),
    });
  } catch {
    return NextResponse.json({ error: "The reset email could not be sent. Check the SMTP configuration." }, { status: 503 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { mustChangePassword: true } });
    await auditCrmChange(tx, admin.user.id, "PASSWORD_RESET_REQUESTED", "User", id);
  });
  return NextResponse.json({ success: true });
}
