/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require("@next/env");
const { MongoClient, ObjectId } = require("mongodb");

loadEnvConfig(process.cwd());

function typeOf(value) {
  if (value instanceof ObjectId) return "objectId";
  if (value instanceof Date) return "date";
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI 未設定");
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15_000,
  });

  try {
    await client.connect();
    const database = client.db();
    const collectionInfos = await database
      .listCollections({}, { nameOnly: false })
      .toArray();
    const collections = [];

    for (const info of collectionInfos) {
      const collection = database.collection(info.name);
      const sample = await collection.findOne({});
      const schema = info.options?.validator?.$jsonSchema;
      collections.push({
        name: info.name,
        documentCount: await collection.countDocuments({}),
        missingPublicationFields:
          info.name === "contactBooks"
            ? await collection.countDocuments({
                $or: [
                  { status: { $exists: false } },
                  { publishedAt: { $exists: false } },
                ],
              })
            : undefined,
        publicationReadback:
          info.name === "contactBooks"
            ? (await collection
                .find({}, { projection: { status: 1, publishedAt: 1 } })
                .toArray())
                .map((record) => ({
                  id: record._id.toHexString(),
                  status: record.status,
                  publishedAtType: typeOf(record.publishedAt),
                }))
            : undefined,
        validatorRequired: schema?.required ?? null,
        validatorFields: Object.keys(schema?.properties ?? {}),
        indexes: (await collection.indexes()).map((index) => ({
          name: index.name,
          key: index.key,
          unique: Boolean(index.unique),
        })),
        sampleFieldTypes: sample
          ? Object.fromEntries(
              Object.entries(sample).map(([key, value]) => [key, typeOf(value)]),
            )
          : null,
      });
    }

    console.log(JSON.stringify({ database: database.databaseName, collections }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
});
