import { Collection, Document, ObjectId } from "mongodb";
import webpush, { type WebPushError } from "web-push";

import { getDatabase } from "@/lib/mongodb";
import {
  getPushSubscriptionsCollection,
} from "@/models/PushSubscription";

export const CONTACT_BOOK_NOTIFICATIONS_COLLECTION = "contactBookNotifications";

export type ContactBookNotificationKind = "published" | "updated";
export type ContactBookNotificationStatus =
  | "pending"
  | "sent"
  | "partial"
  | "failed"
  | "no_subscription";

interface NotificationDelivery {
  subscriptionId: ObjectId;
  status: "sent" | "failed" | "expired";
  attemptCount: number;
  lastAttemptAt: Date;
  statusCode: number | null;
}

export interface ContactBookNotificationDocument extends Document {
  _id: ObjectId;
  eventKey: string;
  requestId: string;
  contactBookId: ObjectId;
  studentId: ObjectId;
  classDate: string;
  kind: ContactBookNotificationKind;
  status: ContactBookNotificationStatus;
  requestedByRole: "admin" | "teacher";
  requestedByAccountId: ObjectId | null;
  deliveries: NotificationDelivery[];
  attemptCount: number;
  processingAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
}

export interface PublicNotificationSummary {
  id: string;
  kind: ContactBookNotificationKind;
  status: ContactBookNotificationStatus;
  sentCount: number;
  failedCount: number;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export const contactBookNotificationsValidator = {
  $jsonSchema: {
    bsonType: "object",
    additionalProperties: false,
    required: [
      "_id",
      "eventKey",
      "requestId",
      "contactBookId",
      "studentId",
      "classDate",
      "kind",
      "status",
      "requestedByRole",
      "requestedByAccountId",
      "deliveries",
      "attemptCount",
      "processingAt",
      "createdAt",
      "updatedAt",
      "sentAt",
    ],
    properties: {
      _id: { bsonType: "objectId" },
      eventKey: { bsonType: "string", maxLength: 200 },
      requestId: { bsonType: "string", maxLength: 100 },
      contactBookId: { bsonType: "objectId" },
      studentId: { bsonType: "objectId" },
      classDate: { bsonType: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
      kind: { enum: ["published", "updated"] },
      status: { enum: ["pending", "sent", "partial", "failed", "no_subscription"] },
      requestedByRole: { enum: ["admin", "teacher"] },
      requestedByAccountId: { bsonType: ["objectId", "null"] },
      deliveries: {
        bsonType: "array",
        items: {
          bsonType: "object",
          additionalProperties: false,
          required: ["subscriptionId", "status", "attemptCount", "lastAttemptAt", "statusCode"],
          properties: {
            subscriptionId: { bsonType: "objectId" },
            status: { enum: ["sent", "failed", "expired"] },
            attemptCount: { bsonType: "int", minimum: 1 },
            lastAttemptAt: { bsonType: "date" },
            statusCode: { bsonType: ["int", "null"] },
          },
        },
      },
      attemptCount: { bsonType: "int", minimum: 0 },
      processingAt: { bsonType: ["date", "null"] },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
      sentAt: { bsonType: ["date", "null"] },
    },
  },
} as const;

export class ContactBookNotificationValidationError extends Error {}

export async function getContactBookNotificationsCollection(): Promise<
  Collection<ContactBookNotificationDocument>
> {
  const database = await getDatabase();
  return database.collection<ContactBookNotificationDocument>(
    CONTACT_BOOK_NOTIFICATIONS_COLLECTION,
  );
}

export async function ensureContactBookNotificationsCollection() {
  const database = await getDatabase();
  const exists = await database
    .listCollections({ name: CONTACT_BOOK_NOTIFICATIONS_COLLECTION }, { nameOnly: true })
    .hasNext();

  if (exists) {
    await database.command({
      collMod: CONTACT_BOOK_NOTIFICATIONS_COLLECTION,
      validator: contactBookNotificationsValidator,
      validationLevel: "strict",
      validationAction: "error",
    });
  } else {
    await database.createCollection<ContactBookNotificationDocument>(
      CONTACT_BOOK_NOTIFICATIONS_COLLECTION,
      {
        validator: contactBookNotificationsValidator,
        validationLevel: "strict",
        validationAction: "error",
      },
    );
  }

  const collection = database.collection<ContactBookNotificationDocument>(
    CONTACT_BOOK_NOTIFICATIONS_COLLECTION,
  );
  await collection.createIndex(
    { eventKey: 1 },
    { unique: true, name: "eventKey_1" },
  );
  await collection.createIndex(
    { contactBookId: 1, createdAt: -1 },
    { name: "contactBookId_1_createdAt_-1" },
  );
  await collection.createIndex(
    { studentId: 1, createdAt: -1 },
    { name: "studentId_1_createdAt_-1" },
  );
  return collection;
}

export function serializeNotification(
  notification: ContactBookNotificationDocument,
): PublicNotificationSummary {
  return {
    id: notification._id.toHexString(),
    kind: notification.kind,
    status: notification.status,
    sentCount: notification.deliveries.filter((item) => item.status === "sent").length,
    failedCount: notification.deliveries.filter((item) => item.status === "failed").length,
    attemptCount: notification.attemptCount,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };
}

export async function latestNotificationsForContactBooks(ids: ObjectId[]) {
  if (ids.length === 0) return new Map<string, PublicNotificationSummary>();
  const collection = await getContactBookNotificationsCollection();
  const rows = await collection
    .aggregate<ContactBookNotificationDocument>([
      { $match: { contactBookId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$contactBookId", notification: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$notification" } },
    ])
    .toArray();
  return new Map(
    rows.map((item) => [item.contactBookId.toHexString(), serializeNotification(item)]),
  );
}

export function buildNotificationDocument(input: {
  requestId: string;
  contactBookId: ObjectId;
  studentId: ObjectId;
  classDate: string;
  kind: ContactBookNotificationKind;
  requestedByRole: "admin" | "teacher";
  requestedByAccountId: ObjectId | null;
}) {
  const requestId = input.requestId.trim();
  if (!/^[0-9a-zA-Z-]{8,100}$/.test(requestId)) {
    throw new ContactBookNotificationValidationError("通知 request ID 不正確");
  }
  const now = new Date();
  return {
    _id: new ObjectId(),
    eventKey: `${input.kind}:${input.contactBookId.toHexString()}:${requestId}`,
    requestId,
    contactBookId: input.contactBookId,
    studentId: input.studentId,
    classDate: input.classDate,
    kind: input.kind,
    status: "pending" as const,
    requestedByRole: input.requestedByRole,
    requestedByAccountId: input.requestedByAccountId,
    deliveries: [],
    attemptCount: 0,
    processingAt: null,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
  };
}

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID 推播環境變數尚未完整設定");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function statusCodeFrom(error: unknown) {
  const statusCode = (error as Partial<WebPushError>)?.statusCode;
  return Number.isInteger(statusCode) ? statusCode! : null;
}

type PushTransport = (
  subscription: {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  },
  payload: string,
) => Promise<unknown>;

async function sendWebPush(
  subscription: Parameters<PushTransport>[0],
  payload: string,
) {
  configureWebPush();
  return webpush.sendNotification(subscription, payload);
}

export async function deliverContactBookNotification(
  notificationId: ObjectId,
  transport: PushTransport = sendWebPush,
) {
  const collection = await getContactBookNotificationsCollection();
  const lockTime = new Date(Date.now() - 2 * 60 * 1000);
  const notification = await collection.findOneAndUpdate(
    {
      _id: notificationId,
      $or: [{ processingAt: null }, { processingAt: { $lt: lockTime } }],
    },
    { $set: { processingAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!notification) {
    const current = await collection.findOne({ _id: notificationId });
    if (!current) throw new Error("找不到通知紀錄");
    return serializeNotification(current);
  }

  const subscriptionsCollection = await getPushSubscriptionsCollection();
  const subscriptions = await subscriptionsCollection
    .find({ studentId: notification.studentId })
    .toArray();
  const deliveries = [...notification.deliveries];
  const bySubscription = new Map(
    deliveries.map((item, index) => [item.subscriptionId.toHexString(), index]),
  );
  const now = new Date();

  for (const subscription of subscriptions) {
    const key = subscription._id.toHexString();
    const existingIndex = bySubscription.get(key);
    if (existingIndex !== undefined && deliveries[existingIndex].status === "sent") continue;

    let delivery: NotificationDelivery;
    try {
      await transport(
        {
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime,
          keys: subscription.keys,
        },
        JSON.stringify({
          title: notification.kind === "published" ? "新聯絡簿已發布" : "聯絡簿內容已更新",
          body:
            notification.kind === "published"
              ? `${notification.classDate} 的新聯絡簿已發布`
              : `${notification.classDate} 的聯絡簿內容已更新`,
          icon: "/icon-192.png",
          badge: "/badge-96.png",
          url: "/dashboard",
        }),
      );
      delivery = {
        subscriptionId: subscription._id,
        status: "sent",
        attemptCount: existingIndex === undefined ? 1 : deliveries[existingIndex].attemptCount + 1,
        lastAttemptAt: now,
        statusCode: 201,
      };
    } catch (error) {
      const statusCode = statusCodeFrom(error);
      const expired = statusCode === 404 || statusCode === 410;
      delivery = {
        subscriptionId: subscription._id,
        status: expired ? "expired" : "failed",
        attemptCount: existingIndex === undefined ? 1 : deliveries[existingIndex].attemptCount + 1,
        lastAttemptAt: now,
        statusCode,
      };
      if (expired) {
        await subscriptionsCollection.deleteOne({ _id: subscription._id });
      } else {
        console.error("推播通知失敗", statusCode ?? "unknown-status");
      }
    }

    if (existingIndex === undefined) {
      bySubscription.set(key, deliveries.length);
      deliveries.push(delivery);
    } else {
      deliveries[existingIndex] = delivery;
    }
  }

  const activeSubscriptions = subscriptions.filter((subscription) => {
    const index = bySubscription.get(subscription._id.toHexString());
    return index === undefined || deliveries[index].status !== "expired";
  });
  const activeIds = new Set(activeSubscriptions.map((item) => item._id.toHexString()));
  const activeDeliveries = deliveries.filter((item) =>
    activeIds.has(item.subscriptionId.toHexString()),
  );
  const sentCount = activeDeliveries.filter((item) => item.status === "sent").length;
  const failedCount = activeDeliveries.filter((item) => item.status === "failed").length;
  const status: ContactBookNotificationStatus =
    activeSubscriptions.length === 0
      ? "no_subscription"
      : sentCount === activeSubscriptions.length
        ? "sent"
        : sentCount > 0
          ? "partial"
          : "failed";
  await collection.updateOne(
    { _id: notificationId },
    {
      $set: {
        deliveries,
        status,
        processingAt: null,
        updatedAt: now,
        sentAt: sentCount > 0 ? notification.sentAt ?? now : notification.sentAt,
      },
      $inc: { attemptCount: 1 },
    },
  );
  const updated = await collection.findOne({ _id: notificationId });
  if (!updated) throw new Error("更新通知狀態後無法查回資料");
  void failedCount;
  return serializeNotification(updated);
}

export async function findNotificationForContactBook(
  notificationId: string,
  contactBookId: ObjectId,
) {
  if (!ObjectId.isValid(notificationId)) {
    throw new ContactBookNotificationValidationError("通知 ID 不正確");
  }
  return getContactBookNotificationsCollection().then((collection) =>
    collection.findOne({ _id: new ObjectId(notificationId), contactBookId }),
  );
}
