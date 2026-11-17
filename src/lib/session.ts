import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRoleName, type RoleName } from "@/lib/permissions";
import { isPreviewMode, PREVIEW_COOKIE, readPreviewSession } from "@/lib/preview-mode";

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  profileId: string | null;
  active: boolean;
  mustChangePassword: boolean;
  preview: boolean;
};

export type SessionUserState =
  | { kind: "unauthenticated" }
  | { kind: "denied" }
  | { kind: "authenticated"; user: AuthenticatedUser };

export async function getSessionUserState(): Promise<SessionUserState> {
  if (isPreviewMode()) {
    const preview = readPreviewSession((await cookies()).get(PREVIEW_COOKIE)?.value);
    if (!preview) return { kind: "unauthenticated" };
    return {
      kind: "authenticated",
      user: {
        id: "local-preview",
        name: "Local Preview Admin",
        email: preview.email,
        role: "PREVIEW" as RoleName,
        profileId: null,
        active: true,
        mustChangePassword: false,
        preview: true,
      },
    };
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return { kind: "unauthenticated" };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      profileId: true,
      profile: { select: { allowLogin: true } },
      active: true,
      mustChangePassword: true,
    },
  });
  if (!user) return { kind: "denied" };
  if (!user.active || !user.profile.allowLogin || !isRoleName(user.role)) return { kind: "denied" };
  return {
    kind: "authenticated",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      profileId: user.profileId,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
      preview: false,
    },
  };
}

export async function getAuthenticatedUser() {
  const state = await getSessionUserState();
  return state.kind === "authenticated" ? state.user : null;
}

export async function getCurrentUser() {
  const user = await getAuthenticatedUser();
  return user && !user.mustChangePassword ? user : null;
}

export async function requireUser() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}

export async function requireRole(roles: RoleName[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/forbidden");
  return user;
}
