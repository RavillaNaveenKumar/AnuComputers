import { createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_COOKIE = "anu_crm_preview";
const PREVIEW_SESSION_SECONDS = 8 * 60 * 60;

type PreviewSession = { email: string; expiresAt: number };

export function isPreviewMode(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv !== "production" && process.env.PREVIEW_MODE === "true";
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function previewCredentialsMatch(email: string, password: string) {
  const expectedEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const expectedPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!expectedEmail || !expectedPassword) return false;
  return secureEqual(email.trim().toLowerCase(), expectedEmail) &&
    secureEqual(password, expectedPassword);
}

export function createPreviewSession(email: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for preview sessions.");
  const payload = Buffer.from(JSON.stringify({
    email,
    expiresAt: Math.floor(Date.now() / 1000) + PREVIEW_SESSION_SECONDS,
  } satisfies PreviewSession)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function readPreviewSession(token: string | undefined) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || !token) return null;
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra || !secureEqual(providedSignature, signature(payload, secret))) return null;

  let session: unknown;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const configuredEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (typeof session !== "object" || session === null || !("email" in session) ||
      typeof session.email !== "string" || !("expiresAt" in session) || typeof session.expiresAt !== "number") return null;
  if (!configuredEmail || session.email !== configuredEmail || !Number.isInteger(session.expiresAt) ||
      session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return { email: session.email, expiresAt: session.expiresAt };
}

export const previewSessionMaxAge = PREVIEW_SESSION_SECONDS;
