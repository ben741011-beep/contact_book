import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());
  const { CONTACT_BOOKS_COLLECTION, ensureContactBooksCollection } = await import(
    "../models/ContactBook"
  );
  const { DATABASE_NAME, getMongoClient } = await import("../lib/mongodb");
  const database = (await getMongoClient()).db(DATABASE_NAME);
  const existingCollection = database.collection(CONTACT_BOOKS_COLLECTION);
  const missingCommentCountBefore = await existingCollection.countDocuments({
    studentComment: { $exists: false },
  });
  const missingMediaCountBefore = await existingCollection.countDocuments({
    media: { $exists: false },
  });
  const missingStatusCountBefore = await existingCollection.countDocuments({
    status: { $exists: false },
  });
  const collection = await ensureContactBooksCollection();
  const { ensureContactBookNotificationsCollection } = await import(
    "../models/ContactBookNotification"
  );
  const { ensurePushSubscriptionsCollection } = await import(
    "../models/PushSubscription"
  );
  const notifications = await ensureContactBookNotificationsCollection();
  const subscriptions = await ensurePushSubscriptionsCollection();
  const indexes = await collection.indexes();
  const missingCommentCountAfter = await collection.countDocuments({
    studentComment: { $exists: false },
  });
  const missingMediaCountAfter = await collection.countDocuments({
    media: { $exists: false },
  });
  const missingStatusCountAfter = await collection.countDocuments({
    status: { $exists: false },
  });

  if (
    collection.dbName !== DATABASE_NAME ||
    collection.collectionName !== CONTACT_BOOKS_COLLECTION
  ) {
    throw new Error("聯絡簿資料庫初始化目標不正確");
  }

  console.log(
    JSON.stringify({
      database: collection.dbName,
      collection: collection.collectionName,
      documentCount: await collection.countDocuments({}),
      migratedCount: missingCommentCountBefore - missingCommentCountAfter,
      migratedMediaCount: missingMediaCountBefore - missingMediaCountAfter,
      migratedPublicationCount: missingStatusCountBefore - missingStatusCountAfter,
      indexes: indexes.map((index) => index.name),
      notificationCollection: notifications.collectionName,
      notificationIndexes: (await notifications.indexes()).map((index) => index.name),
      pushSubscriptionCollection: subscriptions.collectionName,
      pushSubscriptionIndexes: (await subscriptions.indexes()).map((index) => index.name),
    }),
  );
  await (await getMongoClient()).close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "聯絡簿資料庫初始化失敗");
  process.exitCode = 1;
});
