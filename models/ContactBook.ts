import { Collection, Document, MongoServerError, ObjectId } from "mongodb";

import { getDatabase } from "@/lib/mongodb";
import { getAccountsCollection, type SessionRole } from "@/models/Account";

export const CONTACT_BOOKS_COLLECTION = "contactBooks";
export const CONTACT_BOOK_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
] as const;
export const MAX_CONTACT_BOOK_MEDIA_SIZE = 200 * 1024 * 1024;
export const MAX_CONTACT_BOOK_MEDIA_ITEMS = 12;

export type ContactBookMediaType = (typeof CONTACT_BOOK_MEDIA_TYPES)[number];

export interface ContactBookMediaDocument {
  id: string;
  pathname: string;
  contentType: ContactBookMediaType;
  size: number;
  originalName: string;
  uploadedAt: Date;
}

export interface ContactBookActor {
  role: SessionRole;
  accountId: string | null;
}

export interface ContactBookDocument extends Document {
  _id: ObjectId;
  studentId: ObjectId;
  classDate: string;
  lessonContent: string;
  learningFocus: string;
  homework: string;
  nextPreview: string;
  studentComment: string;
  media: ContactBookMediaDocument[];
  createdByRole: "admin" | "teacher";
  createdByAccountId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicContactBook {
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
    contentType: ContactBookMediaType;
    size: number;
    originalName: string;
    uploadedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export const contactBooksValidator = {
  $jsonSchema: {
    bsonType: "object",
    additionalProperties: false,
    required: [
      "_id",
      "studentId",
      "classDate",
      "lessonContent",
      "learningFocus",
      "homework",
      "nextPreview",
      "studentComment",
      "media",
      "createdByRole",
      "createdByAccountId",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      _id: { bsonType: "objectId" },
      studentId: { bsonType: "objectId" },
      classDate: {
        bsonType: "string",
        pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
      },
      lessonContent: { bsonType: "string", maxLength: 5000 },
      learningFocus: { bsonType: "string", maxLength: 5000 },
      homework: { bsonType: "string", maxLength: 5000 },
      nextPreview: { bsonType: "string", maxLength: 5000 },
      studentComment: { bsonType: "string", maxLength: 5000 },
      media: {
        bsonType: "array",
        maxItems: MAX_CONTACT_BOOK_MEDIA_ITEMS,
        items: {
          bsonType: "object",
          additionalProperties: false,
          required: [
            "id",
            "pathname",
            "contentType",
            "size",
            "originalName",
            "uploadedAt",
          ],
          properties: {
            id: { bsonType: "string", pattern: "^[0-9a-f-]{36}$" },
            pathname: { bsonType: "string", maxLength: 1000 },
            contentType: { enum: [...CONTACT_BOOK_MEDIA_TYPES] },
            size: { bsonType: ["int", "long", "double"], minimum: 1 },
            originalName: { bsonType: "string", maxLength: 255 },
            uploadedAt: { bsonType: "date" },
          },
        },
      },
      createdByRole: { enum: ["admin", "teacher"] },
      createdByAccountId: { bsonType: ["objectId", "null"] },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
} as const;

export class ContactBookValidationError extends Error {}
export class ContactBookConflictError extends Error {}

export async function getContactBooksCollection(): Promise<
  Collection<ContactBookDocument>
> {
  const database = await getDatabase();
  return database.collection<ContactBookDocument>(CONTACT_BOOKS_COLLECTION);
}

export async function ensureContactBooksCollection() {
  const database = await getDatabase();
  const existing = await database
    .listCollections({ name: CONTACT_BOOKS_COLLECTION }, { nameOnly: true })
    .hasNext();

  if (existing) {
    const migrationValidator = {
      $jsonSchema: {
        ...contactBooksValidator.$jsonSchema,
        required: contactBooksValidator.$jsonSchema.required.filter(
          (field) => field !== "studentComment" && field !== "media",
        ),
      },
    };
    await database.command({
      collMod: CONTACT_BOOKS_COLLECTION,
      validator: migrationValidator,
      validationLevel: "strict",
      validationAction: "error",
    });
    await database
      .collection<ContactBookDocument>(CONTACT_BOOKS_COLLECTION)
      .updateMany(
        { studentComment: { $exists: false } },
        { $set: { studentComment: "" } },
      );
    await database
      .collection<ContactBookDocument>(CONTACT_BOOKS_COLLECTION)
      .updateMany({ media: { $exists: false } }, { $set: { media: [] } });
    await database.command({
      collMod: CONTACT_BOOKS_COLLECTION,
      validator: contactBooksValidator,
      validationLevel: "strict",
      validationAction: "error",
    });
  } else {
    await database.createCollection<ContactBookDocument>(
      CONTACT_BOOKS_COLLECTION,
      {
        validator: contactBooksValidator,
        validationLevel: "strict",
        validationAction: "error",
      },
    );
  }

  const collection = database.collection<ContactBookDocument>(
    CONTACT_BOOKS_COLLECTION,
  );
  await collection.createIndex(
    { studentId: 1, classDate: 1 },
    { unique: true, name: "studentId_1_classDate_1" },
  );
  await collection.createIndex(
    { classDate: -1, updatedAt: -1 },
    { name: "classDate_-1_updatedAt_-1" },
  );
  return collection;
}

function parseStudentId(value: unknown) {
  if (typeof value !== "string" || !ObjectId.isValid(value)) {
    throw new ContactBookValidationError("學生 ID 不正確");
  }
  return new ObjectId(value);
}

function parseClassDate(value: unknown) {
  const classDate = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(classDate)) {
    throw new ContactBookValidationError("上課日期格式不正確");
  }
  const parsed = new Date(`${classDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== classDate) {
    throw new ContactBookValidationError("上課日期不存在");
  }
  return classDate;
}

function parseSection(value: unknown, label: string) {
  const section = typeof value === "string" ? value.trim() : "";
  if (section.length > 5000) {
    throw new ContactBookValidationError(`${label}不可超過 5000 個字元`);
  }
  return section;
}

function parseInput(input: Record<string, unknown>) {
  return {
    classDate: parseClassDate(input.classDate),
    lessonContent: parseSection(input.lessonContent, "本週上課內容"),
    learningFocus: parseSection(input.learningFocus, "學習重點"),
    homework: parseSection(input.homework, "本週作業"),
    nextPreview: parseSection(input.nextPreview, "下次預告"),
  };
}

async function findManagedStudent(actor: ContactBookActor, studentId: ObjectId) {
  const accounts = await getAccountsCollection();
  if (actor.role === "admin") {
    return accounts.findOne({ _id: studentId, role: "student" });
  }
  if (actor.role === "teacher" && actor.accountId) {
    return accounts.findOne({
      _id: studentId,
      role: "student",
      assignedTeacherId: new ObjectId(actor.accountId),
    });
  }
  if (actor.role === "student" && actor.accountId === studentId.toHexString()) {
    return accounts.findOne({ _id: studentId, role: "student" });
  }
  return null;
}

async function serializeContactBooks(records: ContactBookDocument[]) {
  const studentIds = [...new Set(records.map((record) => record.studentId.toHexString()))];
  const accounts = await getAccountsCollection();
  const students = studentIds.length
    ? await accounts
        .find({ _id: { $in: studentIds.map((id) => new ObjectId(id)) } })
        .toArray()
    : [];
  const studentMap = new Map(students.map((student) => [student._id.toHexString(), student]));

  return records.map<PublicContactBook>((record) => {
    const studentId = record.studentId.toHexString();
    const student = studentMap.get(studentId);
    return {
      id: record._id.toHexString(),
      student: {
        id: studentId,
        name: student?.name ?? null,
        phone: student?.phone ?? null,
      },
      classDate: record.classDate,
      lessonContent: record.lessonContent,
      learningFocus: record.learningFocus,
      homework: record.homework,
      nextPreview: record.nextPreview,
      studentComment: record.studentComment,
      media: (record.media ?? []).map((item) => ({
        id: item.id,
        contentType: item.contentType,
        size: item.size,
        originalName: item.originalName,
        uploadedAt: item.uploadedAt.toISOString(),
      })),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  });
}

export async function listContactBooksFor(actor: ContactBookActor) {
  const collection = await getContactBooksCollection();
  let filter: Document = {};

  if (actor.role === "student") {
    if (!actor.accountId) return [];
    filter = { studentId: new ObjectId(actor.accountId) };
  } else if (actor.role === "teacher") {
    if (!actor.accountId) return [];
    const accounts = await getAccountsCollection();
    const studentIds = await accounts
      .find({
        role: "student",
        assignedTeacherId: new ObjectId(actor.accountId),
      })
      .project<{ _id: ObjectId }>({ _id: 1 })
      .toArray();
    filter = { studentId: { $in: studentIds.map((student) => student._id) } };
  }

  const records = await collection
    .find(filter)
    .sort({ classDate: -1, updatedAt: -1 })
    .toArray();
  return serializeContactBooks(records);
}

export async function createContactBook(
  actor: ContactBookActor,
  input: Record<string, unknown>,
) {
  if (actor.role === "student") {
    throw new ContactBookValidationError("學生沒有新增聯絡簿的權限");
  }
  const studentId = parseStudentId(input.studentId);
  if (!(await findManagedStudent(actor, studentId))) return null;

  const values = parseInput(input);
  const now = new Date();
  const document: Omit<ContactBookDocument, "_id"> = {
    studentId,
    ...values,
    studentComment: "",
    media: [],
    createdByRole: actor.role,
    createdByAccountId:
      actor.role === "teacher" ? new ObjectId(actor.accountId!) : null,
    createdAt: now,
    updatedAt: now,
  };
  const collection = await getContactBooksCollection();

  try {
    const result = await collection.insertOne(document as ContactBookDocument);
    const created = await collection.findOne({ _id: result.insertedId });
    if (!created) throw new Error("新增聯絡簿後無法查回資料");
    return {
      record: (await serializeContactBooks([created]))[0],
      insertedCount: 1,
    };
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new ContactBookConflictError("這位學生在該上課日期已有聯絡簿");
    }
    throw error;
  }
}

export async function updateStudentComment(
  actor: ContactBookActor,
  recordId: string,
  input: Record<string, unknown>,
) {
  if (actor.role !== "student" || !actor.accountId) {
    throw new ContactBookValidationError("只有學生可以填寫學生留言");
  }
  if (!ObjectId.isValid(recordId)) {
    throw new ContactBookValidationError("聯絡簿 ID 不正確");
  }

  const collection = await getContactBooksCollection();
  const _id = new ObjectId(recordId);
  const studentId = new ObjectId(actor.accountId);
  const expectedCount = await collection.countDocuments(
    { _id, studentId },
    { limit: 1 },
  );
  if (expectedCount !== 1) return null;

  const result = await collection.updateOne(
    { _id, studentId },
    {
      $set: {
        studentComment: parseSection(input.studentComment, "學生留言"),
        updatedAt: new Date(),
      },
    },
  );
  const updated = await collection.findOne({ _id, studentId });
  if (!updated) throw new Error("更新學生留言後無法查回資料");

  return {
    record: (await serializeContactBooks([updated]))[0],
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
}

export async function updateContactBook(
  actor: ContactBookActor,
  recordId: string,
  input: Record<string, unknown>,
) {
  if (!ObjectId.isValid(recordId)) {
    throw new ContactBookValidationError("聯絡簿 ID 不正確");
  }
  const collection = await getContactBooksCollection();
  const _id = new ObjectId(recordId);
  const existing = await collection.findOne({ _id });
  if (!existing || !(await findManagedStudent(actor, existing.studentId))) return null;
  if (actor.role === "student") {
    throw new ContactBookValidationError("學生沒有修改聯絡簿的權限");
  }

  try {
    const result = await collection.updateOne(
      { _id },
      { $set: { ...parseInput(input), updatedAt: new Date() } },
    );
    const updated = await collection.findOne({ _id });
    if (!updated) throw new Error("更新聯絡簿後無法查回資料");
    return {
      record: (await serializeContactBooks([updated]))[0],
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new ContactBookConflictError("這位學生在該上課日期已有聯絡簿");
    }
    throw error;
  }
}

async function findAccessibleContactBook(
  actor: ContactBookActor,
  recordId: string,
) {
  if (!ObjectId.isValid(recordId)) {
    throw new ContactBookValidationError("聯絡簿 ID 不正確");
  }
  const collection = await getContactBooksCollection();
  const record = await collection.findOne({ _id: new ObjectId(recordId) });
  if (!record || !(await findManagedStudent(actor, record.studentId))) return null;
  return record;
}

export async function canUploadContactBookMedia(
  actor: ContactBookActor,
  recordId: string,
) {
  if (actor.role === "student") return false;
  return Boolean(await findAccessibleContactBook(actor, recordId));
}

function parseMediaInput(input: Record<string, unknown>): ContactBookMediaDocument {
  const pathname = typeof input.pathname === "string" ? input.pathname.trim() : "";
  const contentType = input.contentType;
  const size = typeof input.size === "number" ? input.size : Number.NaN;
  const originalName =
    typeof input.originalName === "string" ? input.originalName.trim() : "";

  if (!pathname.startsWith("contact-books/") || pathname.length > 1000) {
    throw new ContactBookValidationError("媒體檔案路徑不正確");
  }
  if (!CONTACT_BOOK_MEDIA_TYPES.includes(contentType as ContactBookMediaType)) {
    throw new ContactBookValidationError("只支援 JPG、PNG、WebP、MP4 或 WebM");
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_CONTACT_BOOK_MEDIA_SIZE) {
    throw new ContactBookValidationError("媒體檔案大小不正確");
  }
  if (!originalName || originalName.length > 255) {
    throw new ContactBookValidationError("媒體檔名不正確");
  }

  return {
    id: crypto.randomUUID(),
    pathname,
    contentType: contentType as ContactBookMediaType,
    size,
    originalName,
    uploadedAt: new Date(),
  };
}

export async function addContactBookMedia(
  actor: ContactBookActor,
  recordId: string,
  input: Record<string, unknown>,
) {
  if (actor.role === "student") {
    throw new ContactBookValidationError("學生沒有上傳媒體的權限");
  }
  const existing = await findAccessibleContactBook(actor, recordId);
  if (!existing) return null;
  if ((existing.media ?? []).length >= MAX_CONTACT_BOOK_MEDIA_ITEMS) {
    throw new ContactBookValidationError(
      `每篇聯絡簿最多 ${MAX_CONTACT_BOOK_MEDIA_ITEMS} 個媒體檔案`,
    );
  }

  const media = parseMediaInput(input);
  if (!media.pathname.startsWith(`contact-books/${recordId}/`)) {
    throw new ContactBookValidationError("媒體檔案與聯絡簿不相符");
  }

  const collection = await getContactBooksCollection();
  const _id = new ObjectId(recordId);
  const update: Document = {
    $push: { media },
    $set: { updatedAt: new Date() },
  };
  const result = await collection.updateOne(
    { _id, "media.pathname": { $ne: media.pathname } },
    update,
  );
  if (result.matchedCount !== 1) {
    throw new ContactBookValidationError("這個媒體檔案已加入聯絡簿");
  }
  const updated = await collection.findOne({ _id });
  if (!updated) throw new Error("新增媒體後無法查回聯絡簿");
  return {
    record: (await serializeContactBooks([updated]))[0],
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    mediaId: media.id,
  };
}

export async function findContactBookMedia(
  actor: ContactBookActor,
  recordId: string,
  mediaId: string,
) {
  const record = await findAccessibleContactBook(actor, recordId);
  return record?.media?.find((item) => item.id === mediaId) ?? null;
}

export async function removeContactBookMedia(
  actor: ContactBookActor,
  recordId: string,
  mediaId: string,
) {
  if (actor.role === "student") {
    throw new ContactBookValidationError("學生沒有刪除媒體的權限");
  }
  const existing = await findAccessibleContactBook(actor, recordId);
  if (!existing) return null;
  const media = existing.media?.find((item) => item.id === mediaId);
  if (!media) return null;

  const collection = await getContactBooksCollection();
  const _id = new ObjectId(recordId);
  const update: Document = {
    $pull: { media: { id: mediaId } },
    $set: { updatedAt: new Date() },
  };
  const result = await collection.updateOne({ _id, "media.id": mediaId }, update);
  const updated = await collection.findOne({ _id });
  if (!updated) throw new Error("刪除媒體後無法查回聯絡簿");
  return {
    record: (await serializeContactBooks([updated]))[0],
    media,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
}

export async function deleteContactBook(
  actor: ContactBookActor,
  recordId: string,
) {
  if (!ObjectId.isValid(recordId)) {
    throw new ContactBookValidationError("聯絡簿 ID 不正確");
  }
  const collection = await getContactBooksCollection();
  const _id = new ObjectId(recordId);
  const existing = await collection.findOne({ _id });
  if (!existing || !(await findManagedStudent(actor, existing.studentId))) return null;
  if (actor.role === "student") {
    throw new ContactBookValidationError("學生沒有刪除聯絡簿的權限");
  }

  const expectedCount = await collection.countDocuments({ _id }, { limit: 1 });
  if (expectedCount !== 1) return null;
  const result = await collection.deleteOne({ _id });
  if (result.deletedCount !== 1) throw new Error("刪除聯絡簿筆數不正確");
  const remainingCount = await collection.countDocuments({ _id }, { limit: 1 });
  if (remainingCount !== 0) throw new Error("刪除聯絡簿後仍可查到資料");

  return {
    record: (await serializeContactBooks([existing]))[0],
    expectedCount,
    deletedCount: result.deletedCount,
    remainingCount,
  };
}
