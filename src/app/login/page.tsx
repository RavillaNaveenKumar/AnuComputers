import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/session";
import { LoginForm } from "@/components/login-form";
import { isPreviewMode } from "@/lib/preview-mode";

export default async function LoginPage() {
  const previewMode = isPreviewMode();
  const user = await getAuthenticatedUser();
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/dashboard");
  return <main className="login-screen">
    <div className="login-visual">
      <div className="login-brand"><span className="brand-mark">G</span><strong>GemNava CRM</strong></div>
      <div className="login-message"><div className="eyebrow">THE OPERATIONS DESK</div><h1>Every customer.<br />Every follow-up.<br /><span>Right on track.</span></h1><p>One calm, connected workspace for sales, dispatch, and service.</p></div>
      <div className="login-footnote">Internal team workspace · Asia/Kolkata</div>
    </div>
    <section className="login-panel">
      <div className="login-card"><div className="eyebrow">{previewMode ? "LOCAL UI PREVIEW" : "WELCOME BACK"}</div><h2>Sign in to your workspace</h2><p>Use your work account to continue.</p>{previewMode && <p className="preview-login-note">Demo access only. No database is connected. Changes save in this browser only.</p>}<LoginForm previewMode={previewMode} /></div>
      <span className="login-version">GEMNAVA CRM</span>
    </section>
  </main>;
}
