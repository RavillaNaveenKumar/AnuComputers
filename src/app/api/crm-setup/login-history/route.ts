import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmAdmin } from "@/lib/crm-setup-api";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  userId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(request: Request) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return NextResponse.json({ error: query.error.flatten() }, { status: 400 });
  const history = await prisma.loginHistory.findMany({
    where: query.data.userId ? { userId: query.data.userId } : {},
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: query.data.limit,
  });
  return NextResponse.json(history);
}
