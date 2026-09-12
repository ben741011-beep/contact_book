import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());

  const { ACCOUNTS_COLLECTION, ensureAccountsCollection } = await import(
    "../models/Account"
  );
  const { DATABASE_NAME, getMongoClient } = await import("../lib/mongodb");
  const databaseConnection = (await getMongoClient()).db(DATABASE_NAME);
  const existingCollection =
    databaseConnection.collection(ACCOUNTS_COLLECTION);
  const missingAssignmentCountBefore =
    await existingCollection.countDocuments({
      assignedTeacherId: { $exists: false },
    });
  const collection = await ensureAccountsCollection();
  const database = collection.dbName;
  const indexes = await collection.indexes();
  const count = await collection.countDocuments({});
  const missingAssignmentCountAfter = await collection.countDocuments({
    assignedTeacherId: { $exists: false },
  });

  if (database !== DATABASE_NAME || collection.collectionName !== ACCOUNTS_COLLECTION) {
    throw new Error("資料庫初始化目標不正確");
  }

  console.log(
    JSON.stringify({
      database,
      collection: collection.collectionName,
      documentCount: count,
      migratedCount:
        missingAssignmentCountBefore - missingAssignmentCountAfter,
      indexes: indexes.map((index) => index.name),
    }),
  );

  const client = await getMongoClient();
  await client.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "資料庫初始化失敗");
  process.exitCode = 1;
});
