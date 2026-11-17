import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, username } from "better-auth/plugins";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { revokeUserSessions } from "@/lib/session-revocation";

const profileByRole: Record<string, string> = {
  ADMIN: "system-administrator",
  SALES_MANAGER: "sales-manager",
  SALES_EXECUTIVE: "sales-user",
  SERVICE_MANAGER: "service-manager",
  SERVICE_AGENT: "service-user",
  TECHNICIAN: "technician",
  DISPATCH: "dispatch",
};

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    disableSignUp: true,
    minPasswordLength: 12,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const account = await prisma.user.findUnique({
        where: { id: user.id },
        select: { active: true, profile: { select: { allowLogin: true } } },
      });
      if (!account?.active || !account.profile.allowLogin) return;
      await sendPasswordResetEmail(user.email, url);
    },
    onPasswordReset: async ({ user }) => {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { mustChangePassword: false, passwordChangedAt: new Date() },
        });
        await revokeUserSessions(tx, user.id);
      });
    },
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [
    process.env.APP_URL,
    process.env.BETTER_AUTH_URL,
    ...(process.env.NODE_ENV === "production" ? [] : ["http://127.0.0.1:3000"]),
  ].filter((origin): origin is string => Boolean(origin)),
  user: {
    additionalFields: {
      active: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
      profileId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-in/username": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path !== "/sign-in/email" && context.path !== "/sign-in/username") return;
      const body = context.body as { email?: unknown; username?: unknown } | undefined;
      const identifier = context.path === "/sign-in/email" ? body?.email : body?.username;
      if (typeof identifier !== "string") {
        throw new APIError("UNAUTHORIZED", { message: "Invalid username or password." });
      }
      const normalized = identifier.trim().toLowerCase();
      const user = await prisma.user.findFirst({
        where: context.path === "/sign-in/email" ? { email: normalized } : { username: normalized },
        select: { active: true, profile: { select: { allowLogin: true } } },
      });
      if (!user?.active || !user.profile.allowLogin) throw new APIError("UNAUTHORIZED", { message: "Invalid username or password." });
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const role = typeof user.role === "string" ? user.role : "SALES_EXECUTIVE";
          const profileKey = profileByRole[role];
          if (!profileKey) throw new Error(`No CRM profile is configured for role "${role}".`);
          const profile = await prisma.crmProfile.findUnique({
            where: { key: profileKey },
            select: { id: true },
          });
          if (!profile) throw new Error(`The required CRM profile "${profileKey}" does not exist.`);
          return { data: { ...user, profileId: profile.id } };
        },
      },
    },
    account: {
      update: {
        after: async (account) => {
          if (account.providerId !== "credential") return;
          await prisma.user.updateMany({
            where: { id: account.userId },
            data: { mustChangePassword: false, passwordChangedAt: new Date() },
          });
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { active: true, profile: { select: { allowLogin: true } } },
          });
          return Boolean(user?.active && user.profile.allowLogin);
        },
        after: async (session) => {
          await prisma.$transaction([
            prisma.user.update({
              where: { id: session.userId },
              data: { lastLoginAt: new Date() },
            }),
            prisma.loginHistory.create({
              data: {
                userId: session.userId,
                success: true,
                ipAddress: session.ipAddress,
                userAgent: session.userAgent,
              },
            }),
          ]);
        },
      },
    },
  },
  plugins: [
    admin({ defaultRole: "SALES_EXECUTIVE", adminRoles: ["ADMIN"] }),
    username({ displayUsername: false }),
  ],
});
