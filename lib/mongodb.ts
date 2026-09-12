import { Db, MongoClient } from "mongodb";

export const DATABASE_NAME = "teacher_contact_book";

const globalForMongo = globalThis as typeof globalThis & {
  mongoClientPromise?: Promise<MongoClient>;
};

function createClientPromise() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI 尚未設定");
  }

  return new MongoClient(uri).connect();
}

export function getMongoClient() {
  globalForMongo.mongoClientPromise ??= createClientPromise();
  return globalForMongo.mongoClientPromise;
}

export async function getDatabase(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(DATABASE_NAME);
}
