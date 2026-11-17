"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim().toLowerCase();
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (result.error) setError("The password reset email could not be sent. Check the email address or contact an administrator.");
    else setMessage("If an active account matches that email, a password reset link has been sent.");
    setSaving(false);
  }

  return <form className="login-form" onSubmit={submit}>
    <label className="field"><span>Work email</span><input name="email" type="email" autoComplete="email" required /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="success-message" role="status">{message}</p>}
    <button className="button button-primary login-submit" disabled={saving}>{saving ? "Sending…" : "Send reset link"}</button>
  </form>;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const confirmation = String(form.get("confirmation"));
    if (password !== confirmation) {
      setError("The passwords do not match.");
      setSaving(false);
      return;
    }
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) {
      setError("This reset link is invalid or expired. Request a new link and try again.");
      setSaving(false);
      return;
    }
    router.replace("/login?passwordReset=1");
    router.refresh();
  }

  return <form className="login-form" onSubmit={submit}>
    <label className="field"><span>New password</span><input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
    <label className="field"><span>Confirm new password</span><input name="confirmation" type="password" minLength={12} autoComplete="new-password" required /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary login-submit" disabled={saving}>{saving ? "Updating…" : "Set new password"}</button>
  </form>;
}

export function ChangePasswordForm() {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword"));
    const password = String(form.get("password"));
    const confirmation = String(form.get("confirmation"));
    if (password !== confirmation) {
      setError("The passwords do not match.");
      setSaving(false);
      return;
    }
    const result = await authClient.changePassword({
      currentPassword,
      newPassword: password,
      revokeOtherSessions: true,
    });
    if (result.error) {
      setError("The current password is incorrect or the new password does not meet the requirements.");
      setSaving(false);
      return;
    }
    await authClient.signOut();
    router.replace("/login?passwordChanged=1");
    router.refresh();
  }

  return <form className="login-form" onSubmit={submit}>
    <label className="field"><span>Temporary/current password</span><input name="currentPassword" type="password" autoComplete="current-password" required /></label>
    <label className="field"><span>New password (12+ characters)</span><input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
    <label className="field"><span>Confirm new password</span><input name="confirmation" type="password" minLength={12} autoComplete="new-password" required /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary login-submit" disabled={saving}>{saving ? "Updating…" : "Change password"}</button>
  </form>;
}
