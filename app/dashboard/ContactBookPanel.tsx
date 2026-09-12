"use client";

import { FormEvent, useState } from "react";

interface ContactBookUser {
  id: string;
  username: string;
  role: "admin" | "teacher" | "student";
  name: string | null;
}

interface StudentOption {
  id: string;
  phone: string;
  name: string | null;
  role: "teacher" | "student";
  assignedTeacherId?: string | null;
}

export interface ContactBookRecord {
  id: string;
  student: { id: string; name: string | null; phone: string | null };
  classDate: string;
  lessonContent: string;
  learningFocus: string;
  homework: string;
  nextPreview: string;
  studentComment: string;
  createdAt: string;
  updatedAt: string;
}

const taipeiToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const fields = [
  { name: "lessonContent", label: "本週上課內容", icon: "♫" },
  { name: "learningFocus", label: "學習重點", icon: "◉" },
  { name: "homework", label: "本週作業", icon: "⌂" },
  { name: "nextPreview", label: "下次預告", icon: "⚑" },
] as const;

function formPayload(form: HTMLFormElement) {
  const data = new FormData(form);
  return Object.fromEntries(
    ["studentId", "classDate", ...fields.map((field) => field.name)].map(
      (name) => [name, data.get(name)],
    ),
  );
}

export default function ContactBookPanel({
  user,
  students,
  initialRecords,
  managedStudentId,
}: {
  user: ContactBookUser;
  students: StudentOption[];
  initialRecords: ContactBookRecord[];
  managedStudentId?: string;
}) {
  const [records, setRecords] = useState(initialRecords);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [commentingId, setCommentingId] = useState<string | null>(null);
  const [savedCommentId, setSavedCommentId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(
    initialRecords[0]?.classDate ?? null,
  );
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const canManage = user.role !== "student";
  const studentOptions =
    user.role === "student"
      ? [{ id: user.id, phone: user.username, name: user.name, role: "student" as const }]
      : students.filter((student) => student.role === "student");
  const teacherOptions = students.filter((account) => account.role === "teacher");
  const filteredStudentOptions =
    user.role === "admin"
      ? selectedTeacherId === "unassigned"
        ? studentOptions.filter((student) => !student.assignedTeacherId)
        : studentOptions.filter(
            (student) => student.assignedTeacherId === selectedTeacherId,
          )
      : studentOptions;
  const activeStudentId =
    user.role === "teacher" ? managedStudentId ?? "" : selectedStudentId;
  const visibleRecords =
    user.role === "student"
      ? selectedDate
        ? records.filter((record) => record.classDate === selectedDate)
        : records
      : activeStudentId
        ? records.filter((record) => record.student.id === activeStudentId)
        : [];

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setError("");
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/contact-books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formPayload(form)),
      });
      const result = (await response.json()) as {
        record?: ContactBookRecord;
        error?: string;
      };
      if (!response.ok || !result.record) {
        throw new Error(result.error ?? "無法新增聯絡簿");
      }
      setRecords((current) =>
        [result.record!, ...current].toSorted((a, b) =>
          b.classDate.localeCompare(a.classDate),
        ),
      );
      form.reset();
      setMessage("聯絡簿已新增。");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "無法新增聯絡簿");
    } finally {
      setPending(false);
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>, recordId: string) {
    event.preventDefault();
    setUpdatingId(recordId);
    setSavedId(null);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/contact-books/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formPayload(event.currentTarget)),
      });
      const result = (await response.json()) as {
        record?: ContactBookRecord;
        error?: string;
      };
      if (!response.ok || !result.record) {
        throw new Error(result.error ?? "無法更新聯絡簿");
      }
      setRecords((current) =>
        current
          .map((record) => (record.id === recordId ? result.record! : record))
          .toSorted((a, b) => b.classDate.localeCompare(a.classDate)),
      );
      setSavedId(recordId);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "無法更新聯絡簿");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(record: ContactBookRecord) {
    if (!window.confirm(`確定刪除 ${record.classDate} 的聯絡簿？此操作無法復原。`)) {
      return;
    }
    setDeletingId(record.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/contact-books/${record.id}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as {
        deletedCount?: number;
        error?: string;
      };
      if (!response.ok || result.deletedCount !== 1) {
        throw new Error(result.error ?? "無法刪除聯絡簿");
      }
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setMessage("聯絡簿已刪除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "無法刪除聯絡簿");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleComment(
    event: FormEvent<HTMLFormElement>,
    recordId: string,
  ) {
    event.preventDefault();
    setCommentingId(recordId);
    setSavedCommentId(null);
    setMessage("");
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/contact-books/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentComment: data.get("studentComment") }),
      });
      const result = (await response.json()) as {
        record?: ContactBookRecord;
        error?: string;
      };
      if (!response.ok || !result.record) {
        throw new Error(result.error ?? "無法儲存留言");
      }
      setRecords((current) =>
        current.map((record) =>
          record.id === recordId ? result.record! : record,
        ),
      );
      setSavedCommentId(recordId);
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "無法儲存留言");
    } finally {
      setCommentingId(null);
    }
  }

  return (
    <section className="contact-book-section" aria-labelledby="contact-book-title">
      <div className="section-heading contact-book-heading">
        <div>
          <p className="section-kicker">LESSON NOTES</p>
          <h2 id="contact-book-title">學生聯絡簿</h2>
        </div>
        <span className="count-pill">{visibleRecords.length}</span>
      </div>

      {user.role === "admin" ? (
        <section className="contact-book-filters" aria-label="篩選學生聯絡簿">
          <label>
            <span>老師</span>
            <select
              value={selectedTeacherId}
              onChange={(event) => {
                setSelectedTeacherId(event.target.value);
                setSelectedStudentId("");
              }}
            >
              <option value="">請先選擇老師</option>
              {teacherOptions.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name ?? "尚未設定姓名"}｜{teacher.phone}
                </option>
              ))}
              <option value="unassigned">尚未指派老師</option>
            </select>
          </label>
          <label>
            <span>學生</span>
            <select
              value={selectedStudentId}
              disabled={!selectedTeacherId}
              onChange={(event) => setSelectedStudentId(event.target.value)}
            >
              <option value="">
                {selectedTeacherId ? "請選擇學生" : "請先選擇老師"}
              </option>
              {filteredStudentOptions.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name ?? "尚未設定姓名"}｜{student.phone}
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : user.role === "student" ? (
        <section className="student-date-filter" aria-label="依上課日期篩選">
          <label className="student-date-field">
            <span>上課日期</span>
            <input
              type="date"
              value={selectedDate ?? ""}
              onChange={(event) => setSelectedDate(event.target.value || null)}
            />
          </label>
          <p>
            {selectedDate
              ? `正在顯示 ${selectedDate} 的聯絡簿`
              : "目前顯示全部聯絡簿"}
          </p>
          <button
            className="date-filter-show-all"
            type="button"
            disabled={!selectedDate}
            onClick={() => setSelectedDate(null)}
          >
            顯示全部
          </button>
        </section>
      ) : null}

      {message ? <p className="form-success" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {canManage ? (
        studentOptions.length > 0 ? (
          activeStudentId ? (
            <form className="contact-book-editor new-contact-book" onSubmit={handleCreate}>
              <input type="hidden" name="studentId" value={activeStudentId} />
              <div className="editor-heading">
                <h3>新增課後紀錄</h3>
                <div className="editor-meta-fields date-only">
                  <label>
                    <span>上課日期</span>
                    <input name="classDate" type="date" required defaultValue={taipeiToday} />
                  </label>
                </div>
              </div>
              <div className="contact-field-grid">
                {fields.map((field) => (
                  <label className="contact-field" key={field.name}>
                    <span><b aria-hidden="true">{field.icon}</b>{field.label}</span>
                    <textarea name={field.name} rows={4} maxLength={5000} />
                  </label>
                ))}
              </div>
              <button className="primary-button" type="submit" disabled={pending}>
                {pending ? "儲存中…" : "新增聯絡簿"}
              </button>
            </form>
          ) : null
        ) : (
          <p className="empty-state">請先建立學生帳號，再新增聯絡簿。</p>
        )
      ) : null}

      {visibleRecords.length === 0 ? (
        <p className="empty-state">
          {user.role === "admin" && !selectedTeacherId
            ? "請先選擇老師，再選擇學生。"
            : canManage && !activeStudentId
              ? user.role === "teacher"
                ? "請先從「我的學生」選單選擇學生。"
                : "請選擇要查看的學生。"
              : selectedDate && user.role === "student"
                ? `${selectedDate} 沒有聯絡簿紀錄。`
                : "這位學生目前還沒有聯絡簿紀錄。"}
        </p>
      ) : (
        <div className="contact-book-list">
          {visibleRecords.map((record) => (
            <article className="contact-book-card" key={record.id}>
              <header className="contact-card-header">
                <div>
                  <span className="contact-student-name">
                    {record.student.name ?? "尚未設定姓名"}
                  </span>
                  <small>{record.student.phone ?? "學生帳號已刪除"}</small>
                </div>
                <time dateTime={record.classDate}>上課日期　{record.classDate}</time>
              </header>
              {canManage ? (
                <form className="contact-book-editor" onSubmit={(event) => handleUpdate(event, record.id)}>
                  <input type="hidden" name="studentId" value={record.student.id} />
                  <label className="date-field">
                    <span>上課日期</span>
                    <input name="classDate" type="date" required defaultValue={record.classDate} />
                  </label>
                  <div className="contact-field-grid">
                    {fields.map((field) => (
                      <label className="contact-field" key={field.name}>
                        <span><b aria-hidden="true">{field.icon}</b>{field.label}</span>
                        <textarea name={field.name} rows={4} maxLength={5000} defaultValue={record[field.name]} />
                      </label>
                    ))}
                  </div>
                  <section className="contact-field student-comment-field">
                    <h3><b aria-hidden="true">✎</b>學生留言</h3>
                    <p>{record.studentComment || "尚未留言"}</p>
                  </section>
                  <div className="editor-actions">
                    <button
                      className="secondary-button"
                      type="submit"
                      disabled={updatingId === record.id}
                    >
                      {updatingId === record.id ? "儲存中…" : "儲存修改"}
                    </button>
                    {savedId === record.id ? (
                      <span className="inline-save-status" role="status">✓ 已儲存</span>
                    ) : null}
                    <button
                      className="danger-button"
                      type="button"
                      disabled={deletingId === record.id}
                      onClick={() => handleDelete(record)}
                    >
                      {deletingId === record.id ? "刪除中…" : "刪除聯絡簿"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="contact-field-grid contact-book-view">
                  {fields.map((field) => (
                    <section className="contact-field" key={field.name}>
                      <h3><b aria-hidden="true">{field.icon}</b>{field.label}</h3>
                      <p>{record[field.name] || "尚未填寫"}</p>
                    </section>
                  ))}
                  <form
                    className="contact-field student-comment-field student-comment-form"
                    onSubmit={(event) => handleComment(event, record.id)}
                  >
                    <label htmlFor={`student-comment-${record.id}`}>
                      <b aria-hidden="true">✎</b>學生留言
                    </label>
                    <textarea
                      id={`student-comment-${record.id}`}
                      name="studentComment"
                      rows={4}
                      maxLength={5000}
                      defaultValue={record.studentComment}
                      placeholder="寫下想告訴老師的話…"
                    />
                    <div className="student-comment-actions">
                      <button
                        className="secondary-button"
                        type="submit"
                        disabled={commentingId === record.id}
                      >
                        {commentingId === record.id ? "儲存中…" : "儲存留言"}
                      </button>
                      {savedCommentId === record.id ? (
                        <span className="inline-save-status" role="status">✓ 已儲存</span>
                      ) : null}
                    </div>
                  </form>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
