import { describe, expect, it } from "vitest";
import { crmAppKeySchema, normalizeCrmAppKey } from "./crm-app-key";

describe("CRM application keys", () => {
  it("normalizes a human-friendly application name", () => {
    expect(normalizeCrmAppKey("Anu Computers")).toBe("anu-computers");
    expect(crmAppKeySchema.parse("Anu Computers")).toBe("anu-computers");
  });

  it("normalizes punctuation and prefixes keys that start with a number", () => {
    expect(normalizeCrmAppKey("  2026 CRM!! ")).toBe("app-2026-crm");
  });

  it("rejects values that contain no usable key characters", () => {
    expect(crmAppKeySchema.safeParse("!!!").success).toBe(false);
  });
});
