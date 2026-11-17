"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function LoginForm({ previewMode = false }: { previewMode?: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get("identifier")).trim();
    const password = String(form.get("password"));
    if (previewMode) {
      try {
        const response = await fetch("/api/preview/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: identifier, password }),
        });
        if (!response.ok) {
          const result = await response.json();
          setError(typeof result.error === "string" ? result.error : "Email or password is incorrect.");
          setBusy(false);
          return;
        }
      } catch {
        setError("Sign in could not be completed. Check your connection and try again.");
        setBusy(false);
        return;
      }
    } else {
      const result = identifier.includes("@")
        ? await authClient.signIn.email({ email: identifier.toLowerCase(), password })
        : await authClient.signIn.username({ username: identifier.toLowerCase(), password });
      if (result.error) {
        setError("Email or password is incorrect.");
        setBusy(false);
        return;
      }
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return <form className="login-form" onSubmit={submit}>
    <label className="field"><span>Username or work email</span><input name="identifier" autoComplete="username" required placeholder="username or you@company.com" /></label>
    <label className="field"><span>Password</span><input name="password" type="password" autoComplete="current-password" required placeholder="Enter your password" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary login-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <ArrowRight size={17} /></button>
    {!previewMode && <a className="text-link login-forgot-link" href="/forgot-password">Forgot password?</a>}
    <div className="login-security"><LockKeyhole size={15} /> Staff-only access · Secured session</div>
  </form>;
}
