import type { Prisma } from "@prisma/client";
import type { RoleName } from "@/lib/permissions";

export function customerAccessWhere(user: { id: string; role: RoleName }): Prisma.CustomerWhereInput {
  if (user.role !== "SALES_EXECUTIVE") return {};
  return {
    OR: [
      { ownerId: user.id },
      { leads: { some: { assigneeId: user.id } } },
      { quotes: { some: { createdById: user.id } } },
    ],
  };
}

export function salesRecordWhere(user: { id: string; role: RoleName }) {
  return user.role === "SALES_EXECUTIVE" ? { ownerId: user.id } : {};
}
