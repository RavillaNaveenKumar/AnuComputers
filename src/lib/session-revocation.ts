import type { Prisma } from "@prisma/client";

export async function revokeUserSessions(tx: Prisma.TransactionClient, userId: string) {
  await tx.session.deleteMany({ where: { userId } });
}
