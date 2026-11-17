import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isEmailConfigurationError, safeEmailErrorCode, verifySmtpAndSendTest } from "@/lib/email";
import { auditCrmChange, requireCrmAdmin } from "@/lib/crm-setup-api";

export async function POST() {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;

  try {
    await verifySmtpAndSendTest(admin.user.email);
  } catch (error) {
    if (isEmailConfigurationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({
      error: `SMTP verification or test delivery failed (${safeEmailErrorCode(error)}). Check the server-side SMTP settings.`,
    }, { status: 502 });
  }

  await prisma.$transaction(async (tx) => {
    await auditCrmChange(tx, admin.user.id, "SMTP_TEST_EMAIL_SENT", "SecuritySettings", "smtp");
  });
  return NextResponse.json({ success: true });
}
