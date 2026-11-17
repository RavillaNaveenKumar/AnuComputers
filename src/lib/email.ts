import nodemailer from "nodemailer";

class EmailConfigurationError extends Error {}

function createTransport() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true";
  const from = process.env.MAIL_FROM?.trim() || user;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from) {
    throw new EmailConfigurationError("SMTP settings are incomplete. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM.");
  }
  return {
    transporter: nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure,
      auth: { user, pass },
    }),
    from,
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function assertApplicationResetUrl(value: string) {
  const url = new URL(value);
  const applicationUrl = process.env.APP_URL || process.env.BETTER_AUTH_URL;
  if (!applicationUrl || url.origin !== new URL(applicationUrl).origin) {
    throw new Error("The generated password reset URL is not on the configured application origin.");
  }
  return url.toString();
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const { transporter, from } = createTransport();
  const safeUrl = assertApplicationResetUrl(resetUrl);
  await transporter.sendMail({
    from,
    to,
    subject: "Reset your GemNava CRM password",
    text: `Use this one-time link to reset your password. If you did not request this, ignore this email.\n\n${safeUrl}`,
    html: `<p>Use this one-time link to reset your password. If you did not request this, ignore this email.</p><p><a href="${escapeHtml(safeUrl)}">Reset password</a></p>`,
  });
}

export async function verifySmtpAndSendTest(to: string) {
  const { transporter, from } = createTransport();
  await transporter.verify();
  await transporter.sendMail({
    from,
    to,
    subject: "GemNava CRM SMTP test",
    text: "SMTP verification and test email completed successfully.",
  });
}

export function isEmailConfigurationError(error: unknown): error is Error {
  return error instanceof EmailConfigurationError;
}

export function safeEmailErrorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code.replace(/[^A-Z0-9_]/gi, "").slice(0, 40);
  }
  return "SMTP_ERROR";
}
