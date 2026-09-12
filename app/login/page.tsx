import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const user = await getAuthenticatedUser();
  if (user) redirect("/dashboard");

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">聯</div>
        <p className="eyebrow">Teacher Contact Book</p>
        <h1 id="login-title">師生聯絡簿</h1>
        <p className="subtle">請使用管理員帳號，或由管理者建立的電話帳號登入。</p>
        <LoginForm />
      </section>
    </main>
  );
}
