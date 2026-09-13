import { Collection, Document, ObjectId } from "mongodb";

import { getDatabase } from "@/lib/mongodb";

export const PUSH_SUBSCRIPTIONS_COLLECTION = "pushSubscriptions";

export interface PushSubscriptionDocument extends Document {
  _id: ObjectId;
  studentId: ObjectId;
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
export const pushSubscriptionsValidator = {
  $jsonSchema: {
    bsonType: "object",
    additionalProperties: false,
    required: [
      "_id",
      "studentId",
      "endpoint",
      "expirationTime",
      "keys",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      _id: { bsonType: "objectId" },
      studentId: { bsonType: "objectId" },
      endpoint: { bsonType: "string", maxLength: 4096 },
      expirationTime: { bsonType: ["double", "long", "null"] },
      keys: {
        bsonType: "object",
        additionalProperties: false,
        required: ["p256dh", "auth"],
        properties: {
          p256dh: { bsonType: "string", maxLength: 512 },
          auth: { bsonType: "string", maxLength: 256 },
        },
      },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
} as const;

export class PushSubscriptionValidationError extends Error {}

export async function getPushSubscriptionsCollection(): Promise<
  Collection<PushSubscriptionDocument>
> {
  const database = await getDatabase();
  return database.collection<PushSubscriptionDocument>(
    PUSH_SUBSCRIPTIONS_COLLECTION,
  );
}

export async function ensurePushSubscriptionsCollection() {
  const database = await getDatabase();
  const exists = await database
    .listCollections({ name: PUSH_SUBSCRIPTIONS_COLLECTION }, { nameOnly: true })
    .hasNext();

  if (exists) {
    await database.command({
      collMod: PUSH_SUBSCRIPTIONS_COLLECTION,
      validator: pushSubscriptionsValidator,
      validationLevel: "strict",
      validationAction: "error",
    });
  } else {
    await database.createCollection<PushSubscriptionDocument>(
      PUSH_SUBSCRIPTIONS_COLLECTION,
      {
        validator: pushSubscriptionsValidator,
        validationLevel: "strict",
        validationAction: "error",
      },
    );
  }

  const collection = database.collection<PushSubscriptionDocument>(
    PUSH_SUBSCRIPTIONS_COLLECTION,
  );
  await collection.createIndex(
    { endpoint: 1 },
    { unique: true, name: "endpoint_1" },
  );
  await collection.createIndex(
    { studentId: 1, updatedAt: -1 },
    { name: "studentId_1_updatedAt_-1" },
  );
  return collection;
}

function parseSubscription(input: Record<string, unknown>) {
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  const keys =
    input.keys && typeof input.keys === "object"
      ? (input.keys as Record<string, unknown>)
      : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  const expirationTime = input.expirationTime ?? null;

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new PushSubscriptionValidationError("推播訂閱網址不正確");
  }
  if (parsedEndpoint.protocol !== "https:" || endpoint.length > 4096) {
    throw new PushSubscriptionValidationError("推播訂閱網址不正確");
  }
  if (!p256dh || p256dh.length > 512 || !auth || auth.length > 256) {
    throw new PushSubscriptionValidationError("推播訂閱金鑰不正確");
  }
  if (
    expirationTime !== null &&
    (typeof expirationTime !== "number" || !Number.isFinite(expirationTime))
  ) {
    throw new PushSubscriptionValidationError("推播訂閱到期時間不正確");
  }

  return { endpoint, expirationTime, keys: { p256dh, auth } };
}

export async function savePushSubscription(
  studentId: string,
  input: Record<string, unknown>,
) {
  if (!ObjectId.isValid(studentId)) {
    throw new PushSubscriptionValidationError("學生 ID 不正確");
  }
  const values = parseSubscription(input);
  const collection = await ensurePushSubscriptionsCollection();
  const now = new Date();
  const result = await collection.findOneAndUpdate(
    { endpoint: values.endpoint },
    {
      $set: {
        studentId: new ObjectId(studentId),
        expirationTime: values.expirationTime,
        keys: values.keys,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: "after", includeResultMetadata: true },
  );
  const saved = result.value;
  if (!saved) throw new Error("儲存推播訂閱後無法查回資料");
  return {
    subscriptionId: saved._id.toHexString(),
    enabled: true,
    updatedExisting: Boolean(result.lastErrorObject?.updatedExisting),
  };
}

export async function getPushSubscriptionCount(studentId: string) {
  if (!ObjectId.isValid(studentId)) return 0;
  const collection = await getPushSubscriptionsCollection();
  return collection.countDocuments({ studentId: new ObjectId(studentId) });
}

export async function removePushSubscription(
  studentId: string,
  endpointInput: unknown,
) {
  if (!ObjectId.isValid(studentId)) {
    throw new PushSubscriptionValidationError("學生 ID 不正確");
  }
  const endpoint = typeof endpointInput === "string" ? endpointInput.trim() : "";
  if (!endpoint) {
    throw new PushSubscriptionValidationError("缺少要關閉的推播裝置");
  }
  const collection = await getPushSubscriptionsCollection();
  const filter = { studentId: new ObjectId(studentId), endpoint };
  const expectedCount = await collection.countDocuments(filter, { limit: 1 });
  const result = expectedCount === 1 ? await collection.deleteOne(filter) : null;
  return {
    expectedCount,
    deletedCount: result?.deletedCount ?? 0,
    enabled: false,
  };
}
