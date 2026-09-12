"use client";

import { uploadPresigned } from "@vercel/blob/client";
import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";

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
  media: Array<{
    id: string;
    contentType: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm";
    size: number;
    originalName: string;
    uploadedAt: string;
  }>;
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

const calendarWeekdays = ["日", "一", "二", "三", "四", "五", "六"];
const allowedMediaTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
]);
const maxMediaSize = 200 * 1024 * 1024;
const maxMediaItems = 12;

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function mediaPath(recordId: string, mediaId: string) {
  return `/api/contact-books/${recordId}/media/${mediaId}`;
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(year, monthNumber - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => index + 1);
}

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
  const initialSelectedDate =
    user.role === "teacher" && managedStudentId
      ? initialRecords.find((record) => record.student.id === managedStudentId)?.classDate ?? taipeiToday
      : initialRecords[0]?.classDate ?? null;
  const [records, setRecords] = useState(initialRecords);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [createdForStudentId, setCreatedForStudentId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [commentingId, setCommentingId] = useState<string | null>(null);
  const [savedCommentId, setSavedCommentId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    fileName: string;
    percentage: number;
  } | null>(null);
  const [removingMediaId, setRemovingMediaId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialSelectedDate);
  const [calendarMonth, setCalendarMonth] = useState(
    (initialSelectedDate ?? taipeiToday).slice(0, 7),
  );
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const calendarTrackRef = useRef<HTMLDivElement>(null);
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
  const activeStudentRecords = activeStudentId
    ? records.filter((record) => record.student.id === activeStudentId)
    : [];
  const calendarDays = getMonthDays(calendarMonth);
  const [calendarYear, calendarMonthNumber] = calendarMonth.split("-").map(Number);
  const calendarRecords = user.role === "teacher" ? activeStudentRecords : records;
  const recordDates = new Set(calendarRecords.map((record) => record.classDate));
  const selectedDateHasRecord = Boolean(
    selectedDate && activeStudentRecords.some((record) => record.classDate === selectedDate),
  );
  const shouldShowCreateForm =
    user.role === "admin"
      ? Boolean(activeStudentId)
      : user.role === "teacher"
        ? Boolean(activeStudentId && selectedDate && !selectedDateHasRecord)
        : false;
  const visibleRecords =
    user.role === "student"
      ? selectedDate
        ? records.filter((record) => record.classDate === selectedDate)
        : records
      : user.role === "teacher"
        ? selectedDate
          ? activeStudentRecords.filter((record) => record.classDate === selectedDate)
          : activeStudentRecords
        : activeStudentRecords;

  useEffect(() => {
    calendarTrackRef.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [calendarMonth, selectedDate]);

  function validateMediaFiles(files: File[], existingCount: number) {
    if (files.length === 0) throw new Error("請先選擇照片或影片");
    if (existingCount + files.length > maxMediaItems) {
      throw new Error(`每篇聯絡簿最多 ${maxMediaItems} 個媒體檔案`);
    }
    for (const file of files) {
      if (!allowedMediaTypes.has(file.type)) {
        throw new Error(`${file.name} 格式不支援，請使用 JPG、PNG、WebP、MP4 或 WebM`);
      }
      if (file.size < 1 || file.size > maxMediaSize) {
        throw new Error(`${file.name} 不可超過 200 MB`);
      }
    }
  }

  async function uploadMediaFiles(
    recordId: string,
    files: File[],
    existingCount: number,
  ) {
    validateMediaFiles(files, existingCount);
    setUploadingId(recordId);
    let latestRecord: ContactBookRecord | null = null;

    try {
      for (const [index, file] of files.entries()) {
        setUploadProgress({ fileName: file.name, percentage: 0 });
        const extension = file.name.split(".").pop()?.toLowerCase() || "bin";
        const pathname = `contact-books/${recordId}/media-${Date.now()}-${index}.${extension}`;
        const blob = await uploadPresigned(pathname, file, {
          access: "private",
          handleUploadUrl: `/api/contact-books/${recordId}/media/upload`,
          contentType: file.type,
          multipart: file.size > 100 * 1024 * 1024,
          onUploadProgress: ({ percentage }) => {
            setUploadProgress({ fileName: file.name, percentage: Math.round(percentage) });
          },
        });
        const response = await fetch(`/api/contact-books/${recordId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pathname: blob.pathname,
            originalName: file.name,
          }),
        });
        const result = (await response.json()) as {
          record?: ContactBookRecord;
          error?: string;
        };
        if (!response.ok || !result.record) {
          throw new Error(result.error ?? "媒體已上傳，但無法加入聯絡簿");
        }
        latestRecord = result.record;
        setRecords((current) =>
          current.map((record) =>
            record.id === recordId ? result.record! : record,
          ),
        );
      }
      return latestRecord;
    } finally {
      setUploadingId(null);
      setUploadProgress(null);
    }
  }

  async function handleExistingMediaUpload(record: ContactBookRecord) {
    const input = document.getElementById(
      `media-${record.id}`,
    ) as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    setMessage("");
    setError("");
    try {
      await uploadMediaFiles(record.id, files, record.media.length);
      if (input) input.value = "";
      setMessage("照片／影片已上傳。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "無法上傳媒體");
    }
  }

  async function handleRemoveMedia(recordId: string, mediaId: string) {
    if (!window.confirm("確定要移除這個照片或影片？")) return;
    setRemovingMediaId(mediaId);
    setMessage("");
    setError("");
    try {
      const response = await fetch(
        `/api/contact-books/${recordId}/media/${mediaId}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as {
        record?: ContactBookRecord;
        cleanupWarning?: string;
        error?: string;
      };
      if (!response.ok || !result.record) {
        throw new Error(result.error ?? "無法移除媒體");
      }
      setRecords((current) =>
        current.map((record) =>
          record.id === recordId ? result.record! : record,
        ),
      );
      setMessage(result.cleanupWarning ?? "照片／影片已移除。");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "無法移除媒體");
    } finally {
      setRemovingMediaId(null);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setCreatedForStudentId(null);
    setMessage("");
    setError("");
    const form = event.currentTarget;
    const mediaFiles = Array.from(
      form.querySelector<HTMLInputElement>('input[name="media"]')?.files ?? [],
    );
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
      if (mediaFiles.length > 0) {
        await uploadMediaFiles(result.record.id, mediaFiles, 0);
      }
      setCreatedForStudentId(activeStudentId);
      if (user.role === "teacher" || mediaFiles.length > 0) {
        setMessage(
          mediaFiles.length > 0 ? "聯絡簿與照片／影片已新增。" : "聯絡簿已新增。",
        );
      }
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
      ) : user.role === "student" || (user.role === "teacher" && activeStudentId) ? (
        <section className="student-calendar" aria-label="聯絡簿月曆">
          <div className="calendar-toolbar">
            <div>
              <span className="calendar-eyebrow">上課日期</span>
              <h3>{calendarYear} 年 {calendarMonthNumber} 月</h3>
            </div>
            <div className="calendar-navigation" aria-label="切換月份">
              <button
                type="button"
                aria-label="上一個月"
                onClick={() => {
                  setCalendarMonth((current) => shiftMonth(current, -1));
                  setSelectedDate(null);
                  setMessage("");
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => {
                  setCalendarMonth(taipeiToday.slice(0, 7));
                  setSelectedDate(taipeiToday);
                  setMessage("");
                }}
              >
                今天
              </button>
              <button
                type="button"
                aria-label="下一個月"
                onClick={() => {
                  setCalendarMonth((current) => shiftMonth(current, 1));
                  setSelectedDate(null);
                  setMessage("");
                }}
              >
                ›
              </button>
            </div>
          </div>
          <p className="calendar-swipe-hint">左右滑動選擇日期</p>
          <div className="calendar-track" ref={calendarTrackRef}>
            {calendarDays.map((day) => {
              const date = `${calendarMonth}-${String(day).padStart(2, "0")}`;
              const weekday = calendarWeekdays[
                new Date(calendarYear, calendarMonthNumber - 1, day).getDay()
              ];
              const hasRecord = recordDates.has(date);
              const classNames = [
                "calendar-day",
                date === taipeiToday ? "is-today" : "",
                date === selectedDate ? "is-selected" : "",
                hasRecord ? "has-record" : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  className={classNames}
                  type="button"
                  key={date}
                  aria-label={`${date}${hasRecord ? "，有聯絡簿" : "，沒有聯絡簿"}`}
                  aria-pressed={date === selectedDate}
                  aria-current={date === taipeiToday ? "date" : undefined}
                  onClick={() => {
                    setSelectedDate(date);
                    setMessage("");
                  }}
                >
                  <span className="calendar-day-weekday">週{weekday}</span>
                  <strong>{day}</strong>
                  {hasRecord ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
          <div className="calendar-footer">
            <p>
              {selectedDate
                ? `正在顯示 ${selectedDate} 的聯絡簿`
                : "請選擇日期，或顯示全部聯絡簿"}
            </p>
            <button
              className="date-filter-show-all"
              type="button"
              disabled={!selectedDate}
              onClick={() => {
                setSelectedDate(null);
                setMessage("");
              }}
            >
              顯示全部
            </button>
          </div>
        </section>
      ) : null}

      {message ? <p className="form-success" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {canManage ? (
        studentOptions.length > 0 ? (
          shouldShowCreateForm ? (
            <form
              key={`${activeStudentId}-${user.role === "teacher" ? selectedDate : "new"}`}
              className="contact-book-editor new-contact-book"
              onSubmit={handleCreate}
              onChange={() => setCreatedForStudentId(null)}
            >
              <input type="hidden" name="studentId" value={activeStudentId} />
              {user.role === "teacher" ? (
                <input type="hidden" name="classDate" value={selectedDate ?? ""} readOnly />
              ) : null}
              <div className="editor-heading">
                <h3>
                  {user.role === "teacher" ? `新增 ${selectedDate} 課後紀錄` : "新增課後紀錄"}
                </h3>
                {user.role === "admin" ? (
                  <div className="editor-meta-fields date-only">
                    <label>
                      <span>上課日期</span>
                      <input name="classDate" type="date" required defaultValue={taipeiToday} />
                    </label>
                  </div>
                ) : null}
              </div>
              <div className="contact-field-grid">
                {fields.map((field) => (
                  <label className="contact-field" key={field.name}>
                    <span><b aria-hidden="true">{field.icon}</b>{field.label}</span>
                    <textarea name={field.name} rows={4} maxLength={5000} />
                  </label>
                ))}
              </div>
              <label className="contact-media-upload">
                <span><b aria-hidden="true">▣</b>照片或影片</span>
                <input
                  name="media"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                  multiple
                />
                <small>支援 JPG、PNG、WebP、MP4、WebM；單檔最多 200 MB。</small>
              </label>
              <div className="editor-actions">
                <button className="secondary-button" type="submit" disabled={pending}>
                  {pending
                    ? uploadProgress
                      ? `上傳 ${uploadProgress.fileName} ${uploadProgress.percentage}%`
                      : "新增中…"
                    : "新增聯絡簿"}
                </button>
                {createdForStudentId === activeStudentId ? (
                  <span className="inline-save-status" role="status">✓ 已新增</span>
                ) : null}
              </div>
            </form>
          ) : null
        ) : (
          <p className="empty-state">請先建立學生帳號，再新增聯絡簿。</p>
        )
      ) : null}

      {visibleRecords.length === 0 && !(user.role === "teacher" && activeStudentId && selectedDate) ? (
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
                  <section className="contact-media-section" aria-label="照片與影片">
                    <div className="contact-media-heading">
                      <h3><b aria-hidden="true">▣</b>照片與影片</h3>
                      <span>{record.media.length} / {maxMediaItems}</span>
                    </div>
                    {record.media.length > 0 ? (
                      <div className="contact-media-grid">
                        {record.media.map((media) => (
                          <figure key={media.id} className="contact-media-item">
                            {media.contentType.startsWith("image/") ? (
                              <Image
                                unoptimized
                                src={mediaPath(record.id, media.id)}
                                alt={media.originalName}
                                width={640}
                                height={480}
                              />
                            ) : (
                              <video controls preload="metadata">
                                <source
                                  src={mediaPath(record.id, media.id)}
                                  type={media.contentType}
                                />
                              </video>
                            )}
                            <figcaption>
                              <span title={media.originalName}>{media.originalName}</span>
                              <small>{formatBytes(media.size)}</small>
                              <button
                                className="media-remove-button"
                                type="button"
                                disabled={removingMediaId === media.id}
                                onClick={() => handleRemoveMedia(record.id, media.id)}
                              >
                                {removingMediaId === media.id ? "移除中…" : "移除"}
                              </button>
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    ) : (
                      <p className="contact-media-empty">尚未上傳照片或影片</p>
                    )}
                    <div className="contact-media-controls">
                      <input
                        id={`media-${record.id}`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                        multiple
                        disabled={uploadingId === record.id}
                      />
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={uploadingId === record.id}
                        onClick={() => handleExistingMediaUpload(record)}
                      >
                        {uploadingId === record.id && uploadProgress
                          ? `${uploadProgress.percentage}%`
                          : "上傳照片／影片"}
                      </button>
                    </div>
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
                  <section className="contact-media-section contact-media-view">
                    <div className="contact-media-heading">
                      <h3><b aria-hidden="true">▣</b>照片與影片</h3>
                    </div>
                    {record.media.length > 0 ? (
                      <div className="contact-media-grid">
                        {record.media.map((media) => (
                          <figure key={media.id} className="contact-media-item">
                            {media.contentType.startsWith("image/") ? (
                              <Image
                                unoptimized
                                src={mediaPath(record.id, media.id)}
                                alt={media.originalName}
                                width={640}
                                height={480}
                              />
                            ) : (
                              <video controls preload="metadata">
                                <source
                                  src={mediaPath(record.id, media.id)}
                                  type={media.contentType}
                                />
                              </video>
                            )}
                            <figcaption>
                              <span title={media.originalName}>{media.originalName}</span>
                              <small>{formatBytes(media.size)}</small>
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    ) : (
                      <p className="contact-media-empty">尚未上傳照片或影片</p>
                    )}
                  </section>
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
