import Link from "next/link";
import { ForgotPasswordForm } from "@/components/password-forms";

export default function ForgotPasswordPage() {
  return <main className="login-screen">
    <section className="login-panel">
      <div className="login-card">
        <div className="eyebrow">ACCOUNT RECOVERY</div>
        <h2>Reset your password</h2>
        <p>Enter your work email to request a secure reset link.</p>
        <ForgotPasswordForm />
        <Link className="text-link" href="/login">Return to sign in</Link>
      </div>
    </section>
  </main>;
}
