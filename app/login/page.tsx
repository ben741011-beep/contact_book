import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const user = await getAuthenticatedUser();
  if (user) redirect("/dashboard");

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand-lockup">
          <div className="brand-emblem" aria-hidden="true">
            <svg viewBox="0 0 64 64" role="img">
              <path d="M12 18c8-2 14 0 20 5v27c-6-5-12-7-20-5V18Z" />
              <path d="M52 18c-8-2-14 0-20 5v27c6-5 12-7 20-5V18Z" />
              <path d="M42 13v20" />
              <path d="M42 15l10-3v8l-10 3" />
              <circle cx="38" cy="34" r="4" />
            </svg>
          </div>
          <div className="brand-copy">
            <strong>師生聯絡簿</strong>
            <span>Teacher Contact Book</span>
          </div>
        </div>
        <p className="eyebrow">Welcome back</p>
        <h1 id="login-title">登入帳號</h1>
        <p className="subtle">請使用管理員帳號，或由管理者建立的電話帳號登入。</p>
        <LoginForm />
      </section>
    </main>
  );
}
