import Link from "next/link";
import { ResetPasswordForm } from "@/components/password-forms";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="login-screen">
    <section className="login-panel">
      <div className="login-card">
        <div className="eyebrow">ACCOUNT RECOVERY</div>
        <h2>Choose a new password</h2>
        <p>Password must be at least 12 characters.</p>
        {token ? <ResetPasswordForm token={token} /> : <p className="form-error" role="alert">This reset link is incomplete. Request a new one.</p>}
        <Link className="text-link" href="/forgot-password">Request another link</Link>
      </div>
    </section>
  </main>;
}
