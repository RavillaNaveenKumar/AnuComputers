import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/session";
import { getAppsForUser, getReadableObjectIds } from "@/lib/crm-app-access";

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const apps = user.preview ? [] : await getAppsForUser(user);
  const readableObjectIds = user.preview ? [] : await getReadableObjectIds(user);
  return <AppShell user={user} previewMode={user.preview} readableObjectIds={readableObjectIds} apps={apps}>{children}</AppShell>;
}
