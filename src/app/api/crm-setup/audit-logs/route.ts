import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmAdmin } from "@/lib/crm-setup-api";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });

export async function GET(request: Request) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return NextResponse.json({ error: query.error.flatten() }, { status: 400 });
  const [crmLogs, businessEvents] = await Promise.all([
    prisma.crmAuditLog.findMany({
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: query.data.limit,
    }),
    prisma.auditEvent.findMany({
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: query.data.limit,
    }),
  ]);
  const entries = [
    ...crmLogs.map((entry) => ({
      id: entry.id,
      source: "CRM_SETUP" as const,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      details: entry.details,
      actor: entry.actor,
      createdAt: entry.createdAt,
    })),
    ...businessEvents.map((entry) => ({
      id: entry.id,
      source: "BUSINESS" as const,
      action: entry.action,
      resourceType: entry.entityType,
      resourceId: entry.entityId,
      details: entry.metadata,
      actor: entry.actor,
      createdAt: entry.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, query.data.limit);
  return NextResponse.json(entries);
}
