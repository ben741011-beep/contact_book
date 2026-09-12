import { loadEnvConfig } from "@next/env";
import { ObjectId } from "mongodb";

loadEnvConfig(process.cwd());

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const accountIds: ObjectId[] = [];
const recordIds: ObjectId[] = [];
const results: Record<string, number | boolean> = {};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cookieFrom(response: Response) {
  const header = response.headers.get("set-cookie");
  assert(header, "登入回應沒有 session cookie");
  return header.split(";", 1)[0];
}

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    },
  });
}

async function login(username: string, password: string) {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  assert(response.status === 200, "測試登入失敗");
  return cookieFrom(response);
}

async function createAccount(cookie: string, phone: string, role: string) {
  const response = await request(
    "/api/accounts",
    { method: "POST", body: JSON.stringify({ phone, role }) },
    cookie,
  );
  const body = (await response.json()) as { account?: { id: string } };
  assert(response.status === 201 && body.account, "建立測試帳號失敗");
  accountIds.push(new ObjectId(body.account.id));
  return body.account.id;
}

function recordInput(studentId: string, classDate: string) {
  return {
    studentId,
    classDate,
    lessonContent: "測試上課內容",
    learningFocus: "測試學習重點",
    homework: "測試本週作業",
    nextPreview: "測試下次預告",
  };
}

async function createRecord(
  cookie: string,
  input: ReturnType<typeof recordInput>,
) {
  const response = await request(
    "/api/contact-books",
    { method: "POST", body: JSON.stringify(input) },
    cookie,
  );
  const body = (await response.json()) as { record?: { id: string } };
  if (body.record?.id) recordIds.push(new ObjectId(body.record.id));
  return { response, body };
}

async function assignStudent(
  cookie: string,
  studentId: string,
  teacherId: string,
) {
  return request(
    `/api/accounts/${studentId}/teacher`,
    { method: "PATCH", body: JSON.stringify({ teacherId }) },
    cookie,
  );
}

function forgetRecord(id: string) {
  const index = recordIds.findIndex((recordId) => recordId.toHexString() === id);
  assert(index >= 0, "找不到已刪除的測試聯絡簿");
  recordIds.splice(index, 1);
}

async function cleanup() {
  const { getAccountsCollection } = await import("../models/Account");
  const { getContactBooksCollection } = await import("../models/ContactBook");
  const contactBooks = await getContactBooksCollection();
  const accounts = await getAccountsCollection();

  if (recordIds.length > 0) {
    const expected = await contactBooks.countDocuments({ _id: { $in: recordIds } });
    assert(expected === recordIds.length, "聯絡簿清理目標筆數不正確");
    const result = await contactBooks.deleteMany({ _id: { $in: recordIds } });
    assert(result.deletedCount === recordIds.length, "聯絡簿測試資料未完整清理");
    results.cleanedContactBooks = result.deletedCount;
  }

  if (accountIds.length > 0) {
    const expected = await accounts.countDocuments({ _id: { $in: accountIds } });
    assert(expected === accountIds.length, "帳號清理目標筆數不正確");
    const result = await accounts.deleteMany({ _id: { $in: accountIds } });
    assert(result.deletedCount === accountIds.length, "帳號測試資料未完整清理");
    results.cleanedAccounts = result.deletedCount;
  }
}

async function main() {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  assert(adminUsername && adminPassword, "管理員環境變數缺少");
  const adminCookie = await login(adminUsername, adminPassword);

  const suffix = String(Date.now()).slice(-7);
  const teacherPhone = `091${suffix}`;
  const adminStudentPhone = `092${suffix}`;
  const teacherStudentPhone = `093${suffix}`;
  const teacherId = await createAccount(adminCookie, teacherPhone, "teacher");
  const adminStudentId = await createAccount(adminCookie, adminStudentPhone, "student");
  const teacherCookie = await login(teacherPhone, teacherPhone);
  const teacherStudentId = await createAccount(
    teacherCookie,
    teacherStudentPhone,
    "student",
  );
  const studentCookie = await login(teacherStudentPhone, teacherStudentPhone);
  results.createdAccounts = accountIds.length;

  const adminRecord = await createRecord(
    adminCookie,
    recordInput(adminStudentId, "2099-01-01"),
  );
  assert(adminRecord.response.status === 201 && adminRecord.body.record, "管理者新增聯絡簿失敗");
  const adminRecordId = adminRecord.body.record.id;

  const teacherRecord = await createRecord(
    teacherCookie,
    recordInput(teacherStudentId, "2099-01-02"),
  );
  assert(teacherRecord.response.status === 201 && teacherRecord.body.record, "老師新增聯絡簿失敗");
  const teacherRecordId = teacherRecord.body.record.id;
  results.createdContactBooks = recordIds.length;

  const { getContactBookMediaPathPrefix } = await import("../models/ContactBook");
  const mediaPathPrefix = await getContactBookMediaPathPrefix(
    { role: "teacher", accountId: teacherId },
    teacherRecordId,
  );
  assert(
    mediaPathPrefix === `contact-books/${teacherStudentPhone}/2099-01-02/`,
    "媒體路徑應依學生電話與上課日期建立",
  );
  results.mediaPathUsesPhoneAndDate = true;

  const duplicate = await createRecord(
    teacherCookie,
    recordInput(teacherStudentId, "2099-01-02"),
  );
  assert(duplicate.response.status === 409, "同一學生同一天重複聯絡簿應回傳 409");
  results.duplicateDate = duplicate.response.status;

  const teacherCreatesUnrelated = await createRecord(
    teacherCookie,
    recordInput(adminStudentId, "2099-01-03"),
  );
  assert(teacherCreatesUnrelated.response.status === 404, "老師不可替非自己的學生新增聯絡簿");
  results.teacherCreatesUnrelated = teacherCreatesUnrelated.response.status;

  const studentList = await request("/api/contact-books", {}, studentCookie);
  const studentListBody = (await studentList.json()) as {
    records?: Array<{ id: string }>;
  };
  assert(
    studentList.status === 200 &&
      studentListBody.records?.length === 1 &&
      studentListBody.records[0].id === teacherRecordId,
    "學生只能看見自己的聯絡簿",
  );
  results.studentVisibleRecords = studentListBody.records.length;

  const studentCreate = await request(
    "/api/contact-books",
    {
      method: "POST",
      body: JSON.stringify(recordInput(teacherStudentId, "2099-01-04")),
    },
    studentCookie,
  );
  const studentComment = await request(
    `/api/contact-books/${teacherRecordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        studentComment: "學生測試留言",
        lessonContent: "學生不可修改上課內容",
      }),
    },
    studentCookie,
  );
  const studentCommentBody = (await studentComment.json()) as {
    record?: { studentComment: string; lessonContent: string };
  };
  const studentCommentsUnrelated = await request(
    `/api/contact-books/${adminRecordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ studentComment: "不可跨學生留言" }),
    },
    studentCookie,
  );
  const studentDelete = await request(
    `/api/contact-books/${teacherRecordId}`,
    { method: "DELETE" },
    studentCookie,
  );
  assert(
    studentCreate.status === 403 &&
      studentComment.status === 200 &&
      studentCommentBody.record?.studentComment === "學生測試留言" &&
      studentCommentBody.record.lessonContent === "測試上課內容" &&
      studentCommentsUnrelated.status === 404 &&
      studentDelete.status === 403,
    "學生應只能留言自己的聯絡簿，且不可修改課程內容或刪除紀錄",
  );
  results.studentCommentSaved = true;
  results.studentCommentsUnrelated = studentCommentsUnrelated.status;
  results.studentDeleteDenied = studentDelete.status;

  const teacherUpdatesUnrelated = await request(
    `/api/contact-books/${adminRecordId}`,
    {
      method: "PATCH",
      body: JSON.stringify(recordInput(adminStudentId, "2099-01-01")),
    },
    teacherCookie,
  );
  const teacherDeletesUnrelated = await request(
    `/api/contact-books/${adminRecordId}`,
    { method: "DELETE" },
    teacherCookie,
  );
  assert(
    teacherUpdatesUnrelated.status === 404 && teacherDeletesUnrelated.status === 404,
    "老師不可管理其他學生的聯絡簿",
  );
  results.teacherUnrelatedWrite = teacherDeletesUnrelated.status;

  const assignment = await assignStudent(
    adminCookie,
    adminStudentId,
    teacherId,
  );
  assert(assignment.status === 200, "管理者指派學生給老師失敗");
  const teacherUpdatesAssigned = await request(
    `/api/contact-books/${adminRecordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...recordInput(adminStudentId, "2099-01-01"),
        learningFocus: "指派後老師可更新",
      }),
    },
    teacherCookie,
  );
  assert(
    teacherUpdatesAssigned.status === 200,
    "老師無法管理被指派學生的聯絡簿",
  );
  results.teacherUpdatedAssignedStudent = teacherUpdatesAssigned.status;

  const teacherUpdate = await request(
    `/api/contact-books/${teacherRecordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...recordInput(teacherStudentId, "2099-01-02"),
        learningFocus: "老師已更新重點",
      }),
    },
    teacherCookie,
  );
  assert(teacherUpdate.status === 200, "老師修改自己的學生聯絡簿失敗");

  const adminUpdate = await request(
    `/api/contact-books/${teacherRecordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...recordInput(teacherStudentId, "2099-01-02"),
        nextPreview: "管理者已更新預告",
      }),
    },
    adminCookie,
  );
  assert(adminUpdate.status === 200, "管理者修改全部聯絡簿失敗");
  results.adminUpdatedTeacherRecord = adminUpdate.status;

  const { getContactBooksCollection } = await import("../models/ContactBook");
  const collection = await getContactBooksCollection();
  const stored = await collection.find({ _id: { $in: recordIds } }).toArray();
  assert(
    stored.length === 2 &&
      stored.every(
        (record) =>
          typeof record.lessonContent === "string" &&
          typeof record.learningFocus === "string" &&
          typeof record.homework === "string" &&
          typeof record.nextPreview === "string" &&
          typeof record.studentComment === "string" &&
          Array.isArray(record.media),
      ),
    "聯絡簿新增後查回欄位不完整",
  );
  const commentedRecord = stored.find(
    (record) => record._id.toHexString() === teacherRecordId,
  );
  assert(
    commentedRecord?.studentComment === "學生測試留言",
    "學生留言未以聯絡簿 _id 正確寫入或被老師／管理者修改覆蓋",
  );
  results.readBackById = stored.length;

  const teacherDeletion = await request(
    `/api/contact-books/${teacherRecordId}`,
    { method: "DELETE" },
    teacherCookie,
  );
  const teacherDeletionBody = (await teacherDeletion.json()) as {
    deletedCount?: number;
    remainingCount?: number;
  };
  assert(
    teacherDeletion.status === 200 &&
      teacherDeletionBody.deletedCount === 1 &&
      teacherDeletionBody.remainingCount === 0,
    "老師刪除自己的學生聯絡簿失敗",
  );
  forgetRecord(teacherRecordId);
  results.teacherDeletedOwnRecord = 1;

  const adminDeletion = await request(
    `/api/contact-books/${adminRecordId}`,
    { method: "DELETE" },
    adminCookie,
  );
  const adminDeletionBody = (await adminDeletion.json()) as {
    deletedCount?: number;
    remainingCount?: number;
  };
  assert(
    adminDeletion.status === 200 &&
      adminDeletionBody.deletedCount === 1 &&
      adminDeletionBody.remainingCount === 0,
    "管理者刪除聯絡簿失敗",
  );
  forgetRecord(adminRecordId);
  results.adminDeletedRecord = 1;

  await cleanup();
  results.remainingTestRecords = await collection.countDocuments({
    _id: { $in: recordIds },
  });
  console.log(JSON.stringify({ success: true, results, teacherIdCreated: Boolean(teacherId) }));

  const { getMongoClient } = await import("../lib/mongodb");
  await (await getMongoClient()).close();
}

main().catch(async (error: unknown) => {
  try {
    await cleanup();
    const { getMongoClient } = await import("../lib/mongodb");
    await (await getMongoClient()).close();
  } catch (cleanupError) {
    console.error(cleanupError instanceof Error ? cleanupError.message : "測試資料清理失敗");
  }
  console.error(error instanceof Error ? error.message : "聯絡簿 E2E 測試失敗");
  process.exitCode = 1;
});
