import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/password-forms";
import { getAuthenticatedUser } from "@/lib/session";

export default async function ChangePasswordPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect("/dashboard");
  return <main className="login-screen">
    <section className="login-panel">
      <div className="login-card">
        <div className="eyebrow">SECURITY REQUIREMENT</div>
        <h2>Change your password</h2>
        <p>Set a new password before continuing to the CRM.</p>
        <ChangePasswordForm />
      </div>
    </section>
  </main>;
}
