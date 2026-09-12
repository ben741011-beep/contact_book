import { loadEnvConfig } from "@next/env";
import { ObjectId } from "mongodb";

loadEnvConfig(process.cwd());

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const createdIds: ObjectId[] = [];
const results: Record<string, number | boolean> = {};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cookieFrom(response: Response) {
  const header = response.headers.get("set-cookie");
  assert(header, "登入回應沒有 session cookie");
  return header.split(";", 1)[0];
}

async function request(
  path: string,
  options: RequestInit = {},
  cookie?: string,
) {
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
  return { response, cookie: response.ok ? cookieFrom(response) : "" };
}

async function createAccount(cookie: string, phone: string, role: string) {
  const response = await request(
    "/api/accounts",
    { method: "POST", body: JSON.stringify({ phone, role }) },
    cookie,
  );
  const body = (await response.json()) as { account?: { id: string } };
  if (body.account?.id) createdIds.push(new ObjectId(body.account.id));
  return response;
}

async function cleanupCreatedAccounts() {
  if (createdIds.length === 0) return 0;
  const { getAccountsCollection } = await import("../models/Account");
  const collection = await getAccountsCollection();
  const expectedDeleteCount = await collection.countDocuments({
    _id: { $in: createdIds },
  });
  assert(expectedDeleteCount === createdIds.length, "測試清理目標筆數不正確");
  const deletion = await collection.deleteMany({ _id: { $in: createdIds } });
  assert(deletion.deletedCount === createdIds.length, "測試帳號未完整清理");
  return deletion.deletedCount;
}

function forgetCreatedId(id: string) {
  const index = createdIds.findIndex((createdId) => createdId.toHexString() === id);
  assert(index >= 0, "找不到要移出清理清單的測試帳號");
  createdIds.splice(index, 1);
}

async function deleteViaApi(cookie: string, id: string) {
  const response = await request(
    `/api/accounts/${id}`,
    { method: "DELETE" },
    cookie,
  );
  const body = (await response.json()) as {
    deletedCount?: number;
    remainingCount?: number;
  };
  return { response, body };
}

async function assignStudent(
  cookie: string,
  studentId: string,
  teacherId: string | null,
) {
  const response = await request(
    `/api/accounts/${studentId}/teacher`,
    { method: "PATCH", body: JSON.stringify({ teacherId }) },
    cookie,
  );
  const body = (await response.json()) as {
    account?: { id: string; assignedTeacherId: string | null };
  };
  return { response, body };
}

async function main() {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  assert(adminUsername && adminPassword, "管理員環境變數缺少");

  const suffix = String(Date.now()).slice(-7);
  const teacherPhone = `091${suffix}`;
  const otherTeacherPhone = `092${suffix}`;
  const adminStudentPhone = `093${suffix}`;
  const teacherStudentPhone = `094${suffix}`;
  const otherStudentPhone = `095${suffix}`;

  const invalid = await login("invalid-user", "invalid-password");
  assert(invalid.response.status === 401, "錯誤帳密應回傳 401");
  results.invalidLogin = invalid.response.status;

  const admin = await login(adminUsername, adminPassword);
  assert(admin.response.status === 200, "管理者登入失敗");
  results.adminLogin = admin.response.status;

  for (const [phone, role] of [
    [teacherPhone, "teacher"],
    [otherTeacherPhone, "teacher"],
    [adminStudentPhone, "student"],
  ] as const) {
    const response = await createAccount(admin.cookie, phone, role);
    assert(response.status === 201, `管理者建立 ${role} 失敗`);
  }

  const duplicate = await createAccount(admin.cookie, teacherPhone, "teacher");
  assert(duplicate.status === 409, "重複電話應回傳 409");
  results.duplicatePhone = duplicate.status;

  const invalidPhone = await createAccount(admin.cookie, "12ab", "student");
  assert(invalidPhone.status === 400, "無效電話應回傳 400");
  results.invalidPhone = invalidPhone.status;

  const teacher = await login(teacherPhone, teacherPhone);
  assert(teacher.response.status === 200, "老師登入失敗");
  const teacherCreatesTeacher = await createAccount(
    teacher.cookie,
    `096${suffix}`,
    "teacher",
  );
  assert(teacherCreatesTeacher.status === 403, "老師建立老師應回傳 403");
  results.teacherCreatesTeacher = teacherCreatesTeacher.status;

  const teacherStudent = await createAccount(
    teacher.cookie,
    teacherStudentPhone,
    "student",
  );
  assert(teacherStudent.status === 201, "老師建立學生失敗");

  const otherTeacher = await login(otherTeacherPhone, otherTeacherPhone);
  assert(otherTeacher.response.status === 200, "第二位老師登入失敗");
  const otherStudent = await createAccount(
    otherTeacher.cookie,
    otherStudentPhone,
    "student",
  );
  assert(otherStudent.status === 201, "第二位老師建立學生失敗");

  const teacherList = await request("/api/accounts", {}, teacher.cookie);
  const teacherListBody = (await teacherList.json()) as {
    accounts: Array<{ id: string; phone: string }>;
  };
  assert(teacherList.status === 200, "老師帳號列表失敗");
  assert(
    teacherListBody.accounts.length === 1 &&
      teacherListBody.accounts[0].phone === teacherStudentPhone,
    "老師只應看見自己建立的學生",
  );
  results.teacherVisibleAccounts = teacherListBody.accounts.length;

  const ownStudentId = teacherListBody.accounts[0].id;
  const ownName = await request(
    `/api/accounts/${ownStudentId}/name`,
    { method: "PATCH", body: JSON.stringify({ name: "測試學生" }) },
    teacher.cookie,
  );
  assert(ownName.status === 200, "老師應可設定自己學生姓名");

  const adminList = await request("/api/accounts", {}, admin.cookie);
  const adminListBody = (await adminList.json()) as {
    accounts: Array<{
      id: string;
      phone: string;
      assignedTeacherId: string | null;
    }>;
  };
  const testPhones = new Set([
    teacherPhone,
    otherTeacherPhone,
    adminStudentPhone,
    teacherStudentPhone,
    otherStudentPhone,
  ]);
  const visibleTestAccounts = adminListBody.accounts.filter((account) =>
    testPhones.has(account.phone),
  );
  assert(adminList.status === 200 && visibleTestAccounts.length === 5, "管理者應看見全部測試帳號");
  results.adminVisibleAccounts = adminListBody.accounts.length;

  const unrelated = adminListBody.accounts.find(
    (account) => account.phone === otherStudentPhone,
  );
  const teacherAccount = adminListBody.accounts.find(
    (account) => account.phone === teacherPhone,
  );
  const otherTeacherAccount = adminListBody.accounts.find(
    (account) => account.phone === otherTeacherPhone,
  );
  const adminStudent = adminListBody.accounts.find(
    (account) => account.phone === adminStudentPhone,
  );
  assert(
    unrelated && teacherAccount && otherTeacherAccount && adminStudent,
    "找不到指派測試帳號",
  );

  const teacherCannotAssign = await assignStudent(
    teacher.cookie,
    adminStudent.id,
    teacherAccount.id,
  );
  assert(teacherCannotAssign.response.status === 403, "老師不可指派學生");

  const assignment = await assignStudent(
    admin.cookie,
    adminStudent.id,
    teacherAccount.id,
  );
  assert(
    assignment.response.status === 200 &&
      assignment.body.account?.assignedTeacherId === teacherAccount.id,
    "管理者指派學生給老師失敗",
  );
  const teacherListAfterAssignment = await request(
    "/api/accounts",
    {},
    teacher.cookie,
  );
  const teacherListAfterAssignmentBody =
    (await teacherListAfterAssignment.json()) as {
      accounts: Array<{ phone: string }>;
    };
  assert(
    teacherListAfterAssignment.status === 200 &&
      teacherListAfterAssignmentBody.accounts.some(
        (account) => account.phone === adminStudentPhone,
      ),
    "老師看不到管理者指派的學生",
  );

  const reassignment = await assignStudent(
    admin.cookie,
    adminStudent.id,
    otherTeacherAccount.id,
  );
  assert(
    reassignment.response.status === 200 &&
      reassignment.body.account?.assignedTeacherId === otherTeacherAccount.id,
    "管理者改派學生失敗",
  );
  const unassignment = await assignStudent(admin.cookie, adminStudent.id, null);
  assert(
    unassignment.response.status === 200 &&
      unassignment.body.account?.assignedTeacherId === null,
    "管理者取消指派失敗",
  );
  results.adminAssignmentLifecycle = true;
  results.teacherAssignmentDenied = teacherCannotAssign.response.status;

  const forbiddenName = await request(
    `/api/accounts/${unrelated.id}/name`,
    { method: "PATCH", body: JSON.stringify({ name: "不可修改" }) },
    teacher.cookie,
  );
  assert(forbiddenName.status === 404, "老師不可修改其他老師的學生");
  results.crossTeacherUpdate = forbiddenName.status;

  const student = await login(teacherStudentPhone, teacherStudentPhone);
  assert(student.response.status === 200, "學生登入失敗");
  const studentList = await request("/api/accounts", {}, student.cookie);
  assert(studentList.status === 403, "學生查看帳號應回傳 403");
  const studentCreate = await createAccount(student.cookie, `097${suffix}`, "student");
  assert(studentCreate.status === 403, "學生建立帳號應回傳 403");
  const studentDelete = await deleteViaApi(student.cookie, ownStudentId);
  assert(studentDelete.response.status === 403, "學生刪除帳號應回傳 403");
  results.studentList = studentList.status;
  results.studentCreate = studentCreate.status;
  results.studentDelete = studentDelete.response.status;

  const logout = await request("/api/auth/logout", { method: "POST" }, student.cookie);
  assert(logout.status === 200, "登出失敗");
  const meAfterLogout = await request("/api/auth/me", {}, cookieFrom(logout));
  assert(meAfterLogout.status === 401, "登出後 /me 應回傳 401");
  results.meAfterLogout = meAfterLogout.status;

  const { getAccountsCollection } = await import("../models/Account");
  const collection = await getAccountsCollection();
  const stored = await collection.find({ _id: { $in: createdIds } }).toArray();
  assert(stored.length === createdIds.length, "新增帳號未完整以 _id 查回");
  assert(
    stored.every(
      (account) =>
        !("password" in account) &&
        account.passwordHash !== account.phone &&
        account.passwordHash.startsWith("$2"),
    ),
    "密碼未正確雜湊或存在明文欄位",
  );
  results.insertedAndReadBack = stored.length;

  const crossTeacherDelete = await deleteViaApi(teacher.cookie, unrelated.id);
  assert(crossTeacherDelete.response.status === 404, "老師不可刪除其他老師的學生");
  results.crossTeacherDelete = crossTeacherDelete.response.status;

  const teacherDelete = await deleteViaApi(teacher.cookie, ownStudentId);
  assert(
    teacherDelete.response.status === 200 &&
      teacherDelete.body.deletedCount === 1 &&
      teacherDelete.body.remainingCount === 0,
    "老師刪除自己的學生失敗",
  );
  forgetCreatedId(ownStudentId);
  results.teacherDeletedOwnStudent = teacherDelete.body.deletedCount ?? 0;

  const deletedStudentSession = await request("/api/auth/me", {}, student.cookie);
  assert(deletedStudentSession.status === 401, "已刪除學生的 session 應立即失效");
  results.deletedStudentSession = deletedStudentSession.status;

  const deletableTeacher = visibleTestAccounts.find(
    (account) => account.phone === otherTeacherPhone,
  );
  assert(adminStudent && deletableTeacher, "找不到管理者刪除測試目標");

  for (const target of [adminStudent, deletableTeacher]) {
    const deletion = await deleteViaApi(admin.cookie, target.id);
    assert(
      deletion.response.status === 200 &&
        deletion.body.deletedCount === 1 &&
        deletion.body.remainingCount === 0,
      "管理者刪除帳號失敗",
    );
    forgetCreatedId(target.id);
  }
  results.adminDeletedAccounts = 2;

  const adminListAfterTeacherDelete = await request(
    "/api/accounts",
    {},
    admin.cookie,
  );
  const adminListAfterTeacherDeleteBody =
    (await adminListAfterTeacherDelete.json()) as {
      accounts: Array<{
        phone: string;
        assignedTeacherId: string | null;
      }>;
    };
  const studentAfterTeacherDelete =
    adminListAfterTeacherDeleteBody.accounts.find(
      (account) => account.phone === otherStudentPhone,
    );
  assert(
    adminListAfterTeacherDelete.status === 200 &&
      studentAfterTeacherDelete?.assignedTeacherId === null,
    "刪除老師後，其學生應變成未指派",
  );
  results.teacherDeletionUnassignedStudents = true;

  results.deletedTestAccounts = await cleanupCreatedAccounts();
  results.remainingTargetAccounts = await collection.countDocuments({
    _id: { $in: createdIds },
  });

  console.log(JSON.stringify({ success: true, results }));
  const { getMongoClient } = await import("../lib/mongodb");
  await (await getMongoClient()).close();
}

main().catch(async (error: unknown) => {
  try {
    await cleanupCreatedAccounts();
  } catch (cleanupError) {
    console.error(
      cleanupError instanceof Error ? cleanupError.message : "測試資料清理失敗",
    );
  }
  if (createdIds.length > 0) {
    const { getMongoClient } = await import("../lib/mongodb");
    await (await getMongoClient()).close();
  }
  console.error(error instanceof Error ? error.message : "E2E 測試失敗");
  process.exitCode = 1;
});
