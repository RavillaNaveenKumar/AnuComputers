import { prisma } from "@/lib/prisma";

export async function audit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, string | number | boolean | null>,
) {
  await prisma.auditEvent.create({
    data: { actorId, action, entityType, entityId, metadata },
  });
}
