import { afterEach, describe, expect, it } from "vitest";
import {
  createPreviewSession,
  isPreviewMode,
  previewCredentialsMatch,
  readPreviewSession,
} from "./preview-mode";

const keys = ["PREVIEW_MODE", "NODE_ENV", "SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD", "BETTER_AUTH_SECRET"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else Reflect.set(process.env, key, value);
  }
});

describe("local preview authentication", () => {
  it("only enables preview mode outside production when explicitly configured", () => {
    process.env.PREVIEW_MODE = "true";
    expect(isPreviewMode("development")).toBe(true);
    expect(isPreviewMode("production")).toBe(false);
  });

  it("matches configured local credentials without connecting to auth storage", () => {
    process.env.SEED_ADMIN_EMAIL = "admin@example.test";
    process.env.SEED_ADMIN_PASSWORD = "preview-password";
    expect(previewCredentialsMatch("ADMIN@example.test", "preview-password")).toBe(true);
    expect(previewCredentialsMatch("admin@example.test", "incorrect")).toBe(false);
  });

  it("accepts signed sessions and rejects tampered tokens", () => {
    process.env.BETTER_AUTH_SECRET = "test-only-secret-with-sufficient-length";
    process.env.SEED_ADMIN_EMAIL = "admin@example.test";
    const token = createPreviewSession("admin@example.test");
    expect(readPreviewSession(token)?.email).toBe("admin@example.test");
    expect(readPreviewSession(`${token}tampered`)).toBeNull();
  });
});
