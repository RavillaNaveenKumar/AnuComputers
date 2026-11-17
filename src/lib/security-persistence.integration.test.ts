import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { testDatabaseUrl } = vi.hoisted(() => ({
  testDatabaseUrl: process.env.SECURITY_TEST_DATABASE_URL,
}));

function databaseIdentity(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

vi.mock("@/lib/prisma", async () => {
  if (!testDatabaseUrl) return { prisma: null };
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const configuredDatabaseUrl = process.env.DATABASE_URL;
  if (configuredDatabaseUrl && databaseIdentity(testDatabaseUrl) === databaseIdentity(configuredDatabaseUrl)) {
    throw new Error("SECURITY_TEST_DATABASE_URL must point to a database separate from DATABASE_URL.");
  }
  const { PrismaClient } = await import("@prisma/client");
  return {
    prisma: new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } }),
  };
});
vi.mock("@/lib/authorization", () => ({ evaluateAuthorization: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auditCrmChange } from "./crm-setup-api";
import { revokeUserSessions } from "./session-revocation";

const databaseDescribe = describe.skipIf(!testDatabaseUrl);
const testRunId = randomUUID();
const testUserId = `security-test-${testRunId}`;
const auditResourceId = `audit-persistence-${testRunId}`;

databaseDescribe("security persistence integration", () => {
  beforeAll(async () => {
    const profile = await prisma.crmProfile.findUnique({
      where: { key: "system-administrator" },
      select: { id: true },
    });
    if (!profile) throw new Error("Apply migrations and seed the dedicated security test database first.");
    await prisma.user.create({
      data: {
        id: testUserId,
        name: "Security Integration Test",
        email: `${testRunId}@security-test.invalid`,
        role: "ADMIN",
        profileId: profile.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.crmAuditLog.deleteMany({
      where: { resourceType: "SecurityIntegrationTest", resourceId: auditResourceId },
    });
    await prisma.session.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  it("commits session revocation to PostgreSQL", async () => {
    const sessionId = randomUUID();
    await prisma.session.create({
      data: {
        id: sessionId,
        token: randomUUID(),
        userId: testUserId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await prisma.session.count({ where: { id: sessionId } })).toBe(1);

    await prisma.$transaction((tx) => revokeUserSessions(tx, testUserId));

    expect(await prisma.session.count({ where: { id: sessionId } })).toBe(0);
  });

  it("persists an audit event after its transaction commits", async () => {
    await prisma.$transaction((tx) =>
      auditCrmChange(tx, testUserId, "SECURITY_TEST", "SecurityIntegrationTest", auditResourceId, {
        runId: testRunId,
      }),
    );

    const event = await prisma.crmAuditLog.findFirst({
      where: { resourceType: "SecurityIntegrationTest", resourceId: auditResourceId },
      select: { actorId: true, action: true, details: true },
    });
    expect(event).toMatchObject({
      actorId: testUserId,
      action: "SECURITY_TEST",
      details: { runId: testRunId },
    });
  });
});
