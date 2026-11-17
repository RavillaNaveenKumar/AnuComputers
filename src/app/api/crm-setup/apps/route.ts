import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, isPrismaUniqueError, requireCrmAdmin } from "@/lib/crm-setup-api";
import { crmAppKeySchema } from "@/lib/crm-app-key";

const appSchema = z.object({
  key: crmAppKeySchema,
  name: z.string().trim().min(1).max(80),
  icon: z.string().trim().min(1).max(40).default("Boxes"),
  defaultObjectId: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const apps = await prisma.crmApp.findMany({
    include: {
      defaultObject: { select: { id: true, name: true, pluralLabel: true, apiName: true } },
      assignments: {
        include: { object: { select: { id: true, name: true, pluralLabel: true, apiName: true, module: true, active: true, icon: true } } },
        orderBy: { navigationOrder: "asc" },
      },
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ apps });
}

export async function POST(request: Request) {
  const auth = await requireCrmAdmin();
  if ("response" in auth) return auth.response;
  const input = appSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message ?? "Application details are invalid." }, { status: 400 });
  if (input.data.defaultObjectId && !await prisma.crmObject.findFirst({ where: { id: input.data.defaultObjectId, active: true } })) {
    return NextResponse.json({ error: "The default landing object must be active." }, { status: 400 });
  }
  try {
    const app = await prisma.$transaction(async (tx) => {
      if (input.data.isDefault) await tx.crmApp.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const created = await tx.crmApp.create({ data: {
        ...input.data,
        defaultObjectId: input.data.defaultObjectId ?? null,
        isDefault: input.data.isDefault ?? false,
      } });
      await auditCrmChange(tx, auth.user.id, "APP_CREATED", "CrmApp", created.id, { key: created.key });
      return tx.crmApp.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          assignments: { include: { object: { select: { id: true, name: true, pluralLabel: true, apiName: true, module: true, active: true, icon: true } } } },
        },
      });
    });
    return NextResponse.json(app, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueError(error)) return NextResponse.json({ error: "An application with that key or name already exists." }, { status: 409 });
    throw error;
  }
}
