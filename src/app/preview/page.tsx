import { redirect } from "next/navigation";
import { PreviewWorkspace } from "@/components/preview-workspace";
import { requireUser } from "@/lib/session";

export default async function PreviewPage() {
  const user = await requireUser();
  if (!user.preview) redirect("/dashboard");
  return <PreviewWorkspace name={user.name} />;
}
