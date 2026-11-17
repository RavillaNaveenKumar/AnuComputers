import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditCrmChange, isPrismaUniqueError, requireCrmAdmin } from "@/lib/crm-setup-api";
import { revokeUserSessions } from "@/lib/session-revocation";

const roles = ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE", "DISPATCH", "SERVICE_MANAGER", "SERVICE_AGENT", "TECHNICIAN"] as const;
const pageSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["active", "inactive", "all"]).default("all"),
  role: z.enum(roles).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const createSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).transform((value) => value.toLowerCase()),
  email: z.email().trim().transform((value) => value.toLowerCase()),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(40).optional().transform((value) => value || null),
  role: z.enum(roles),
  profileId: z.string().min(1),
});
const updateSchema = z.object({
  userId: z.string().min(1),
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).transform((value) => value.toLowerCase()).optional(),
  email: z.email().trim().transform((value) => value.toLowerCase()).optional(),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  role: z.enum(roles).optional(),
  profileId: z.string().min(1).optional(),
  active: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
}).refine(({ username, email, firstName, lastName, phone, role, profileId, active, mustChangePassword }) =>
  [username, email, firstName, lastName, phone, role, profileId, active, mustChangePassword].some((value) => value !== undefined),
{ message: "Provide at least one field to update." });

const safeUserSelect = {
  id: true,
  username: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  profile: { select: { id: true, name: true } },
  active: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export async function GET(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const query = pageSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return NextResponse.json({ error: query.error.flatten() }, { status: 400 });

  const where = {
    ...(query.data.status === "all" ? {} : { active: query.data.status === "active" }),
    ...(query.data.role ? { role: query.data.role } : {}),
    ...(query.data.q ? {
      OR: [
        { username: { contains: query.data.q, mode: "insensitive" as const } },
        { email: { contains: query.data.q, mode: "insensitive" as const } },
        { firstName: { contains: query.data.q, mode: "insensitive" as const } },
        { lastName: { contains: query.data.q, mode: "insensitive" as const } },
        { name: { contains: query.data.q, mode: "insensitive" as const } },
      ],
    } : {}),
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: safeUserSelect,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { email: "asc" }],
      skip: (query.data.page - 1) * query.data.pageSize,
      take: query.data.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return NextResponse.json({
    users,
    page: query.data.page,
    pageSize: query.data.pageSize,
    total,
    pageCount: Math.ceil(total / query.data.pageSize),
  });
}

export async function POST(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = createSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

  const profile = await prisma.crmProfile.findUnique({
    where: { id: input.data.profileId },
    select: { id: true, key: true, allowLogin: true },
  });
  if (!profile || !profile.allowLogin) return NextResponse.json({ error: "Choose an existing profile that allows login." }, { status: 409 });
  if ((input.data.role === "ADMIN") !== (profile.key === "system-administrator")) {
    return NextResponse.json({ error: "The System Administrator role and profile must be assigned together." }, { status: 409 });
  }
  const id = randomUUID();
  const initialPasswordHash = await hashPassword(randomBytes(32).toString("base64url"));
  const name = `${input.data.firstName} ${input.data.lastName}`;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id,
          username: input.data.username,
          email: input.data.email,
          name,
          firstName: input.data.firstName,
          lastName: input.data.lastName,
          phone: input.data.phone,
          role: input.data.role,
          profileId: profile.id,
          active: true,
          mustChangePassword: true,
          accounts: {
            create: {
              id: randomUUID(),
              accountId: id,
              providerId: "credential",
              password: initialPasswordHash,
            },
          },
        },
        select: safeUserSelect,
      });
      await auditCrmChange(tx, admin.user.id, "USER_CREATED", "User", id, {
        username: input.data.username,
        role: input.data.role,
        passwordSetupRequired: true,
      });
      return user;
    });
    return NextResponse.json({ user: created, passwordSetupRequired: true }, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueError(error)) {
      return NextResponse.json({ error: "That username or email address is already assigned." }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const admin = await requireCrmAdmin();
  if ("response" in admin) return admin.response;
  const input = updateSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const { userId, ...changes } = input.data;
  if (userId === admin.user.id && changes.active === false) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 409 });
  }

  const profile = changes.profileId
    ? await prisma.crmProfile.findUnique({ where: { id: changes.profileId }, select: { id: true, key: true, allowLogin: true } })
    : null;
  if (changes.profileId && !profile) return NextResponse.json({ error: "The selected profile does not exist." }, { status: 409 });
  if (profile && changes.active !== false && !profile.allowLogin) {
    return NextResponse.json({ error: "The selected profile does not allow login for active users." }, { status: 409 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(779834019)::text AS locked;`;
      const existing = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, profileId: true, active: true, firstName: true, lastName: true },
      });
      if (!existing) return null;

      const willRemainAdmin = (changes.role ?? existing.role) === "ADMIN";
      const willBeActive = changes.active ?? existing.active;
      const selectedProfile = profile ?? await tx.crmProfile.findUniqueOrThrow({
        where: { id: existing.profileId },
        select: { id: true, key: true, allowLogin: true },
      });
      if (willRemainAdmin !== (selectedProfile.key === "system-administrator")) throw new Error("PROFILE_ROLE_MISMATCH");
      if (willBeActive && !selectedProfile.allowLogin) throw new Error("PROFILE_LOGIN_DISABLED");
      if (existing.role === "ADMIN" && existing.active && (!willRemainAdmin || !willBeActive)) {
        const activeAdmins = await tx.user.count({ where: { role: "ADMIN", active: true } });
        if (activeAdmins <= 1) throw new Error("LAST_ACTIVE_ADMIN");
      }

      const saved = await tx.user.update({
        where: { id: userId },
        data: {
          ...(changes.username ? { username: changes.username } : {}),
          ...(changes.email ? { email: changes.email, emailVerified: false } : {}),
          ...(changes.firstName ? { firstName: changes.firstName } : {}),
          ...(changes.lastName ? { lastName: changes.lastName } : {}),
          ...(changes.firstName || changes.lastName
            ? { name: `${changes.firstName ?? existing.firstName ?? ""} ${changes.lastName ?? existing.lastName ?? ""}`.trim() }
            : {}),
          ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
          ...(changes.role ? { role: changes.role } : {}),
          ...(changes.profileId && profile ? { profileId: profile.id } : {}),
          ...(changes.active !== undefined ? { active: changes.active } : {}),
          ...(changes.mustChangePassword !== undefined ? { mustChangePassword: changes.mustChangePassword } : {}),
        },
        select: safeUserSelect,
      });

      if (changes.active === false) await revokeUserSessions(tx, userId);
      await auditCrmChange(tx, admin.user.id, "USER_UPDATED", "User", userId, {
        ...(changes.role ? { role: changes.role } : {}),
        ...(changes.profileId ? { profileId: changes.profileId } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
        ...(changes.mustChangePassword !== undefined ? { mustChangePassword: changes.mustChangePassword } : {}),
      });
      return saved;
    });
    if (!updated) return NextResponse.json({ error: "User not found." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "LAST_ACTIVE_ADMIN") {
      return NextResponse.json({ error: "At least one active System Administrator must remain." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "PROFILE_ROLE_MISMATCH") {
      return NextResponse.json({ error: "The System Administrator role and profile must be assigned together." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "PROFILE_LOGIN_DISABLED") {
      return NextResponse.json({ error: "An active user must have a profile that allows login." }, { status: 409 });
    }
    if (isPrismaUniqueError(error)) {
      return NextResponse.json({ error: "That username or email address is already assigned." }, { status: 409 });
    }
    throw error;
  }
}
