import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authorization", () => ({
  evaluateAuthorization: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/native-crm-records", () => ({ listNativeCrmRecordIds: vi.fn() }));
vi.mock("@/lib/validators", () => ({ customerSchema: { safeParse: vi.fn() } }));

import { evaluateAuthorization } from "@/lib/authorization";
import { GET, POST } from "./route";

describe("GET /api/customers authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    vi.mocked(evaluateAuthorization).mockResolvedValue({
      allowed: false,
      status: 401,
      error: "Sign in is required.",
    });

    const response = await GET(new Request("http://localhost/api/customers"));

    expect(response.status).toBe(401);
  });

  it("returns 403 when an authenticated request is denied", async () => {
    vi.mocked(evaluateAuthorization).mockResolvedValue({
      allowed: false,
      status: 403,
      error: "You do not have permission to access this object.",
    });

    const response = await GET(new Request("http://localhost/api/customers"));

    expect(response.status).toBe(403);
  });

  it("rejects a direct create attempt before parsing or writing customer data", async () => {
    vi.mocked(evaluateAuthorization).mockResolvedValue({
      allowed: false,
      status: 403,
      error: "You do not have permission to access this object.",
    });

    const response = await POST(new Request("http://localhost/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Restricted Customer" }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(403);
  });
});
