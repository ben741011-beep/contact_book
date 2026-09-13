"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import ContactBookPanel, { type ContactBookRecord } from "./ContactBookPanel";
import PushNotificationManager from "./PushNotificationManager";

type Role = "admin" | "teacher" | "student";

interface User {
  id: string;
  username: string;
  role: Role;
  name: string | null;
}

interface Account {
  id: string;
  phone: string;
  role: "teacher" | "student";
  name: string | null;
  createdByRole: "admin" | "teacher";
  assignedTeacherId: string | null;
  createdAt: string;
}

const roleLabels: Record<Role, string> = {
  admin: "管理者",
  teacher: "老師",
  student: "學生",
};

export default function DashboardClient({
  user,
  initialAccounts,
  initialContactBooks,
}: {
  user: User;
  initialAccounts: Account[];
  initialContactBooks: ContactBookRecord[];
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignedId, setAssignedId] = useState<string | null>(null);
  const [accountTab, setAccountTab] = useState<"student" | "teacher">(
    "student",
  );
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const teachers = accounts.filter((account) => account.role === "teacher");
  const studentCount = accounts.filter(
    (account) => account.role === "student",
  ).length;
  const tabAccounts = accounts.filter((account) => account.role === accountTab);
  const accountOptions = user.role === "admin" ? tabAccounts : accounts;
  const visibleAccounts = accountOptions.filter(
    (account) => account.id === selectedAccountId,
  );
  const accountCount = accountOptions.length;

  async function loadAccounts() {
    if (user.role === "student") return;
    setLoading(true);
    try {
      const response = await fetch("/api/accounts", { cache: "no-store" });
      const result = (await response.json()) as { accounts?: Account[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "無法讀取帳號");
      setAccounts(result.accounts ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "無法讀取帳號");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: data.get("phone"),
          role: user.role === "teacher" ? "student" : data.get("role"),
        }),
      });
      const result = (await response.json()) as {
        account?: Account;
        error?: string;
      };
      if (!response.ok || !result.account) {
        throw new Error(result.error ?? "無法建立帳號");
      }
      form.reset();
      setMessage("帳號已建立，初始密碼與電話相同。");
      await loadAccounts();
      if (user.role === "admin") setAccountTab(result.account.role);
      setSelectedAccountId(result.account.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "無法建立帳號");
    } finally {
      setPending(false);
    }
  }

  async function handleNameSubmit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setError("");
    setMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/accounts/${id}/name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.get("name") }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "無法設定姓名");
      return;
    }
    setMessage("姓名已更新。");
    await loadAccounts();
  }

  async function handleTeacherAssignment(
    event: FormEvent<HTMLFormElement>,
    studentId: string,
  ) {
    event.preventDefault();
    setAssigningId(studentId);
    setAssignedId(null);
    setError("");
    setMessage("");
    const data = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/accounts/${studentId}/teacher`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: data.get("teacherId") || null }),
      });
      const result = (await response.json()) as {
        account?: Account;
        error?: string;
      };
      if (!response.ok || !result.account) {
        throw new Error(result.error ?? "無法指派老師");
      }
      setAccounts((current) =>
        current.map((account) =>
          account.id === studentId ? result.account! : account,
        ),
      );
      setAssignedId(studentId);
    } catch (assignmentError) {
      setError(
        assignmentError instanceof Error
          ? assignmentError.message
          : "無法指派老師",
      );
    } finally {
      setAssigningId(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  async function handleDelete(account: Account) {
    const label = account.name ? `${account.name}（${account.phone}）` : account.phone;
    if (!window.confirm(`確定要刪除${roleLabels[account.role]} ${label}？此操作無法復原。`)) {
      return;
    }

    setDeletingId(account.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/accounts/${account.id}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as {
        error?: string;
        deletedCount?: number;
      };
      if (!response.ok || result.deletedCount !== 1) {
        throw new Error(result.error ?? "無法刪除帳號");
      }
      setAccounts((current) =>
        current
          .filter((item) => item.id !== account.id)
          .map((item) =>
            item.assignedTeacherId === account.id
              ? { ...item, assignedTeacherId: null }
              : item,
          ),
      );
      if (selectedAccountId === account.id) setSelectedAccountId("");
      setMessage("帳號已刪除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "無法刪除帳號");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Teacher Contact Book</p>
          <h1>師生聯絡簿</h1>
        </div>
        <button className="ghost-button" type="button" onClick={handleLogout}>登出</button>
      </header>

      <section className="welcome-card">
        <div>
          <span className={`role-badge role-${user.role}`}>{roleLabels[user.role]}</span>
          <h2>{user.name ?? "尚未設定姓名"}</h2>
          <p>{user.username}</p>
        </div>
        <p className="welcome-copy">
          {user.role === "admin"
            ? "你可以建立老師與學生帳號、指派學生，並管理所有使用者姓名。"
            : user.role === "teacher"
              ? "你可以建立學生帳號，並管理自己建立的學生姓名。"
              : "你的帳號已啟用。目前沒有帳號管理權限。"}
        </p>
      </section>

      {user.role === "student" ? <PushNotificationManager /> : null}

      {user.role !== "student" ? (
        <div className="dashboard-grid">
          <section className="panel" aria-labelledby="create-title">
            <p className="section-kicker">CREATE ACCOUNT</p>
            <h2 id="create-title">建立新帳號</h2>
            <form className="stack-form" onSubmit={handleCreate}>
              <label>
                <span>電話</span>
                <input name="phone" inputMode="numeric" pattern="[0-9]{8,15}" minLength={8} maxLength={15} required placeholder="請輸入 8–15 位數字" />
              </label>
              {user.role === "admin" ? (
                <label>
                  <span>角色</span>
                  <select name="role" defaultValue="student">
                    <option value="student">學生</option>
                    <option value="teacher">老師</option>
                  </select>
                </label>
              ) : null}
              <button className="primary-button" type="submit" disabled={pending}>
                {pending ? "建立中…" : "建立帳號"}
              </button>
            </form>
          </section>

          <section className="panel account-panel" aria-labelledby="account-title">
            <div className="section-heading">
              <div>
                <p className="section-kicker">ACCOUNTS</p>
                <h2 id="account-title">{user.role === "admin" ? "全部帳號" : "我的學生"}</h2>
              </div>
              <span className="count-pill">{accountCount}</span>
            </div>
            {message ? <p className="form-success" role="status">{message}</p> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {user.role === "admin" ? (
              <div className="account-tabs" role="tablist" aria-label="帳號角色">
                <button
                  className={accountTab === "student" ? "is-active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={accountTab === "student"}
                  aria-controls="account-tab-panel"
                  onClick={() => {
                    setAccountTab("student");
                    setSelectedAccountId("");
                  }}
                >
                  同學 <span>{studentCount}</span>
                </button>
                <button
                  className={accountTab === "teacher" ? "is-active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={accountTab === "teacher"}
                  aria-controls="account-tab-panel"
                  onClick={() => {
                    setAccountTab("teacher");
                    setSelectedAccountId("");
                  }}
                >
                  老師 <span>{teachers.length}</span>
                </button>
              </div>
            ) : null}
            {accountOptions.length > 0 ? (
              <label className="student-account-select">
                <span>
                  {user.role === "admin"
                    ? accountTab === "student"
                      ? "同學"
                      : "老師"
                    : "學生"}
                </span>
                <select
                  value={selectedAccountId}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                >
                  <option value="">
                    請選擇{user.role === "admin" && accountTab === "teacher" ? "老師" : "學生"}
                  </option>
                  {accountOptions.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name ?? "尚未設定姓名"}｜{account.phone}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {loading ? (
              <p className="empty-state">載入中…</p>
            ) : accountOptions.length > 0 && !selectedAccountId ? (
              <p className="empty-state">
                請從上方選擇要管理的
                {user.role === "admin" && accountTab === "teacher" ? "老師" : "學生"}。
              </p>
            ) : visibleAccounts.length === 0 ? (
              <p className="empty-state">
                {user.role === "admin"
                  ? `目前還沒有${accountTab === "student" ? "同學" : "老師"}帳號。`
                  : "目前還沒有學生帳號。"}
              </p>
            ) : (
              <div
                className="account-list"
                id="account-tab-panel"
                role={user.role === "admin" ? "tabpanel" : undefined}
              >
                {visibleAccounts.map((account) => (
                  <article className="account-row" key={account.id}>
                    <div className="account-meta">
                      <span className={`role-badge role-${account.role}`}>{roleLabels[account.role]}</span>
                      <strong>{account.name ?? "尚未設定姓名"}</strong>
                      <small>{account.phone}</small>
                    </div>
                    <div className="account-actions">
                      {user.role === "admin" && account.role === "student" ? (
                        <form
                          className="teacher-assignment-form"
                          onSubmit={(event) =>
                            handleTeacherAssignment(event, account.id)
                          }
                        >
                          <label htmlFor={`teacher-${account.id}`}>指派老師</label>
                          <select
                            id={`teacher-${account.id}`}
                            name="teacherId"
                            defaultValue={account.assignedTeacherId ?? ""}
                          >
                            <option value="">未指派</option>
                            {teachers.map((teacher) => (
                              <option key={teacher.id} value={teacher.id}>
                                {teacher.name ?? "尚未設定姓名"}｜{teacher.phone}
                              </option>
                            ))}
                          </select>
                          <button
                            className="secondary-button"
                            type="submit"
                            disabled={assigningId === account.id}
                          >
                            {assigningId === account.id ? "指派中…" : "儲存指派"}
                          </button>
                          {assignedId === account.id ? (
                            <span className="inline-save-status" role="status">
                              ✓ 已指派
                            </span>
                          ) : null}
                        </form>
                      ) : null}
                      <form className="name-form" onSubmit={(event) => handleNameSubmit(event, account.id)}>
                        <label className="sr-only" htmlFor={`name-${account.id}`}>姓名</label>
                        <input id={`name-${account.id}`} name="name" defaultValue={account.name ?? ""} maxLength={80} required placeholder="設定姓名" />
                        <button className="secondary-button" type="submit">儲存</button>
                      </form>
                      <button
                        className="danger-button"
                        type="button"
                        disabled={deletingId === account.id}
                        onClick={() => handleDelete(account)}
                      >
                        {deletingId === account.id ? "刪除中…" : "刪除帳號"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      <ContactBookPanel
        key={user.role === "teacher" ? selectedAccountId : "contact-books"}
        user={user}
        students={accounts}
        initialRecords={initialContactBooks}
        managedStudentId={user.role === "teacher" ? selectedAccountId : undefined}
      />
    </main>
  );
}
