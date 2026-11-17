import Link from "next/link";

export default function ForbiddenPage() {
  return <main className="login-screen"><section className="login-panel"><div className="login-card"><div className="eyebrow">ACCESS RESTRICTED</div><h2>You don’t have permission</h2><p>Your account cannot open this page. Contact an Admin if you need access.</p><Link className="button button-primary" href="/dashboard">Back to dashboard</Link></div></section></main>;
}
