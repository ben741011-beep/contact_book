import { compare, hash } from "bcryptjs";
import {
  Collection,
  Document,
  MongoServerError,
  ObjectId,
} from "mongodb";

import { getDatabase } from "@/lib/mongodb";

export const ACCOUNTS_COLLECTION = "accounts";
export const ACCOUNT_ROLES = ["teacher", "student"] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export type SessionRole = "admin" | AccountRole;

export interface AccountDocument extends Document {
  _id: ObjectId;
  phone: string;
  passwordHash: string;
  role: AccountRole;
  name: string | null;
  createdByRole: "admin" | "teacher";
  createdByAccountId: ObjectId | null;
  assignedTeacherId: ObjectId | null;
  createdAt: Date;
}

export interface AccountActor {
  role: "admin" | "teacher";
  accountId: string | null;
}

export interface PublicAccount {
  id: string;
  phone: string;
  role: AccountRole;
  name: string | null;
  createdByRole: "admin" | "teacher";
  createdByAccountId: string | null;
  assignedTeacherId: string | null;
  createdAt: string;
}

export const accountsValidator = {
  $jsonSchema: {
    bsonType: "object",
    additionalProperties: false,
    required: [
      "_id",
      "phone",
      "passwordHash",
      "role",
      "name",
      "createdByRole",
      "createdByAccountId",
      "assignedTeacherId",
      "createdAt",
    ],
    properties: {
      _id: { bsonType: "objectId" },
      phone: { bsonType: "string", pattern: "^[0-9]{8,15}$" },
      passwordHash: { bsonType: "string", minLength: 20 },
      role: { enum: [...ACCOUNT_ROLES] },
      name: { bsonType: ["string", "null"], maxLength: 80 },
      createdByRole: { enum: ["admin", "teacher"] },
      createdByAccountId: { bsonType: ["objectId", "null"] },
      assignedTeacherId: { bsonType: ["objectId", "null"] },
      createdAt: { bsonType: "date" },
    },
  },
} as const;

export class AccountValidationError extends Error {}
export class AccountConflictError extends Error {}

export async function getAccountsCollection(): Promise<
  Collection<AccountDocument>
> {
  const database = await getDatabase();
  return database.collection<AccountDocument>(ACCOUNTS_COLLECTION);
}

export async function ensureAccountsCollection() {
  const database = await getDatabase();
  const existing = await database
    .listCollections({ name: ACCOUNTS_COLLECTION }, { nameOnly: true })
    .hasNext();

  if (existing) {
    const migrationValidator = {
      $jsonSchema: {
        ...accountsValidator.$jsonSchema,
        required: accountsValidator.$jsonSchema.required.filter(
          (field) => field !== "assignedTeacherId",
        ),
      },
    };
    await database.command({
      collMod: ACCOUNTS_COLLECTION,
      validator: migrationValidator,
      validationLevel: "strict",
      validationAction: "error",
    });
    const migrationCollection =
      database.collection<AccountDocument>(ACCOUNTS_COLLECTION);
    await migrationCollection.updateMany(
      {
        role: "student",
        createdByRole: "teacher",
        assignedTeacherId: { $exists: false },
      },
      [{ $set: { assignedTeacherId: "$createdByAccountId" } }],
    );
    await migrationCollection.updateMany(
      { assignedTeacherId: { $exists: false } },
      { $set: { assignedTeacherId: null } },
    );
    await database.command({
      collMod: ACCOUNTS_COLLECTION,
      validator: accountsValidator,
      validationLevel: "strict",
      validationAction: "error",
    });
  } else {
    await database.createCollection<AccountDocument>(ACCOUNTS_COLLECTION, {
      validator: accountsValidator,
      validationLevel: "strict",
      validationAction: "error",
    });
  }

  const collection = database.collection<AccountDocument>(ACCOUNTS_COLLECTION);
  await collection.createIndex({ phone: 1 }, { unique: true, name: "phone_1" });
  await collection.createIndex(
    { createdByAccountId: 1, role: 1 },
    { name: "createdByAccountId_1_role_1" },
  );
  await collection.createIndex(
    { assignedTeacherId: 1, role: 1 },
    { name: "assignedTeacherId_1_role_1" },
  );

  return collection;
}

export function parsePhone(value: unknown) {
  const phone = typeof value === "string" ? value.trim() : "";
  if (!/^\d{8,15}$/.test(phone)) {
    throw new AccountValidationError("電話必須是 8 至 15 位數字");
  }
  return phone;
}

export function parseAccountRole(value: unknown): AccountRole {
  if (value !== "teacher" && value !== "student") {
    throw new AccountValidationError("帳號角色不正確");
  }
  return value;
}

export function parseName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80) {
    throw new AccountValidationError("姓名必須為 1 至 80 個字元");
  }
  return name;
}

export function serializeAccount(account: AccountDocument): PublicAccount {
  return {
    id: account._id.toHexString(),
    phone: account.phone,
    role: account.role,
    name: account.name,
    createdByRole: account.createdByRole,
    createdByAccountId: account.createdByAccountId?.toHexString() ?? null,
    assignedTeacherId: account.assignedTeacherId?.toHexString() ?? null,
    createdAt: account.createdAt.toISOString(),
  };
}

export async function findAccountForLogin(phone: string) {
  const collection = await getAccountsCollection();
  return collection.findOne({ phone });
}

export async function verifyAccountPassword(
  account: AccountDocument,
  password: string,
) {
  return compare(password, account.passwordHash);
}

export async function findAccountById(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const collection = await getAccountsCollection();
  return collection.findOne({ _id: new ObjectId(id) });
}

export async function createAccount(
  actor: AccountActor,
  input: { phone: unknown; role: unknown },
) {
  const phone = parsePhone(input.phone);
  const role = parseAccountRole(input.role);

  if (actor.role === "teacher" && role !== "student") {
    throw new AccountValidationError("老師只能建立學生帳號");
  }

  if (actor.role === "teacher" && !actor.accountId) {
    throw new AccountValidationError("建立者資料不完整");
  }

  const collection = await getAccountsCollection();
  const document: Omit<AccountDocument, "_id"> = {
    phone,
    passwordHash: await hash(phone, 12),
    role,
    name: null,
    createdByRole: actor.role,
    createdByAccountId:
      actor.role === "teacher" ? new ObjectId(actor.accountId!) : null,
    assignedTeacherId:
      role === "student" && actor.role === "teacher"
        ? new ObjectId(actor.accountId!)
        : null,
    createdAt: new Date(),
  };

  try {
    const result = await collection.insertOne(document as AccountDocument);
    const created = await collection.findOne({ _id: result.insertedId });
    if (!created) throw new Error("新增帳號後無法查回資料");
    return { account: serializeAccount(created), insertedCount: 1 };
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new AccountConflictError("這個電話已經有帳號");
    }
    throw error;
  }
}

export async function listAccountsFor(actor: AccountActor) {
  const collection = await getAccountsCollection();
  const filter =
    actor.role === "admin"
      ? {}
      : {
          role: "student" as const,
          assignedTeacherId: new ObjectId(actor.accountId!),
        };
  const accounts = await collection.find(filter).sort({ createdAt: -1 }).toArray();
  return accounts.map(serializeAccount);
}

export async function updateAccountName(
  actor: AccountActor,
  accountId: string,
  nameInput: unknown,
) {
  if (!ObjectId.isValid(accountId)) {
    throw new AccountValidationError("帳號 ID 不正確");
  }

  const name = parseName(nameInput);
  const _id = new ObjectId(accountId);
  const collection = await getAccountsCollection();
  const filter =
    actor.role === "admin"
      ? { _id }
      : {
          _id,
          role: "student" as const,
          assignedTeacherId: new ObjectId(actor.accountId!),
        };

  const existing = await collection.countDocuments(filter, { limit: 1 });
  if (existing !== 1) return null;

  const result = await collection.updateOne(filter, { $set: { name } });
  const updated = await collection.findOne({ _id });
  if (!updated) throw new Error("更新姓名後無法查回資料");

  return {
    account: serializeAccount(updated),
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
}

export async function deleteAccount(actor: AccountActor, accountId: string) {
  if (!ObjectId.isValid(accountId)) {
    throw new AccountValidationError("帳號 ID 不正確");
  }

  const _id = new ObjectId(accountId);
  const collection = await getAccountsCollection();
  const filter =
    actor.role === "admin"
      ? { _id }
      : {
          _id,
          role: "student" as const,
          assignedTeacherId: new ObjectId(actor.accountId!),
        };

  const expectedCount = await collection.countDocuments(filter, { limit: 1 });
  if (expectedCount !== 1) return null;

  const target = await collection.findOne(filter);
  if (!target) return null;

  const result = await collection.deleteOne(filter);
  if (result.deletedCount !== 1) {
    throw new Error("刪除帳號筆數不正確");
  }

  const remainingCount = await collection.countDocuments({ _id }, { limit: 1 });
  if (remainingCount !== 0) {
    throw new Error("刪除帳號後仍可查到資料");
  }

  let unassignedStudents = 0;
  if (actor.role === "admin" && target.role === "teacher") {
    const unassignment = await collection.updateMany(
      { role: "student", assignedTeacherId: target._id },
      { $set: { assignedTeacherId: null } },
    );
    unassignedStudents = unassignment.modifiedCount;
  }

  return {
    account: serializeAccount(target),
    expectedCount,
    deletedCount: result.deletedCount,
    remainingCount,
    unassignedStudents,
  };
}

export async function assignStudentToTeacher(
  actor: AccountActor,
  studentId: string,
  teacherIdInput: unknown,
) {
  if (actor.role !== "admin") {
    throw new AccountValidationError("只有管理者可以指派學生");
  }
  if (!ObjectId.isValid(studentId)) {
    throw new AccountValidationError("學生 ID 不正確");
  }

  const collection = await getAccountsCollection();
  const _id = new ObjectId(studentId);
  const studentCount = await collection.countDocuments(
    { _id, role: "student" },
    { limit: 1 },
  );
  if (studentCount !== 1) return null;

  let assignedTeacherId: ObjectId | null = null;
  if (teacherIdInput !== null && teacherIdInput !== "") {
    if (typeof teacherIdInput !== "string" || !ObjectId.isValid(teacherIdInput)) {
      throw new AccountValidationError("老師 ID 不正確");
    }
    assignedTeacherId = new ObjectId(teacherIdInput);
    const teacherCount = await collection.countDocuments(
      { _id: assignedTeacherId, role: "teacher" },
      { limit: 1 },
    );
    if (teacherCount !== 1) {
      throw new AccountValidationError("找不到老師帳號");
    }
  }

  const result = await collection.updateOne(
    { _id, role: "student" },
    { $set: { assignedTeacherId } },
  );
  const updated = await collection.findOne({ _id, role: "student" });
  if (!updated) throw new Error("指派老師後無法查回學生帳號");

  return {
    account: serializeAccount(updated),
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
}
