import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authorization", () => ({
  evaluateAuthorization: vi.fn(),
  evaluateNativeFieldAuthorization: vi.fn(),
  evaluateUserAuthorization: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findMany: vi.fn() },
    lead: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
    purchasedUnit: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/native-crm-records", () => ({ listNativeCrmRecordIds: vi.fn() }));

import {
  evaluateAuthorization,
  evaluateNativeFieldAuthorization,
  evaluateUserAuthorization,
} from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

const user = {
  id: "sales-1",
  name: "Sales Executive",
  email: "sales@example.test",
  role: "SALES_EXECUTIVE" as const,
  profileId: "profile-1",
  active: true,
  mustChangePassword: false,
  preview: false,
};

describe("GET /api/search field authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("denies a direct search when a searchable field is hidden", async () => {
    vi.mocked(evaluateAuthorization).mockResolvedValue({ allowed: true, user });
    vi.mocked(evaluateUserAuthorization).mockResolvedValue({ allowed: true, user });
    vi.mocked(evaluateNativeFieldAuthorization).mockImplementation(async (_user, apiName) =>
      apiName === "Lead"
        ? { allowed: false, status: 403, error: "You do not have read access to one or more fields." }
        : { allowed: true, user },
    );

    const response = await GET(new Request("http://localhost/api/search?q=private"));

    expect(response.status).toBe(403);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});
