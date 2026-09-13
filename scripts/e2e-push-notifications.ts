import { loadEnvConfig } from "@next/env";
import { ObjectId } from "mongodb";

loadEnvConfig(process.cwd());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const { createAccount, getAccountsCollection } = await import("../models/Account");
  const {
    buildNotificationDocument,
    deliverContactBookNotification,
    ensureContactBookNotificationsCollection,
  } = await import("../models/ContactBookNotification");
  const {
    ensurePushSubscriptionsCollection,
    savePushSubscription,
  } = await import("../models/PushSubscription");
  const suffix = String(Date.now()).slice(-7);
  const created = await createAccount(
    { role: "admin", accountId: null },
    { phone: `098${suffix}`, role: "student" },
  );
  const studentId = new ObjectId(created.account.id);
  const contactBookId = new ObjectId();
  const notifications = await ensureContactBookNotificationsCollection();
  const subscriptions = await ensurePushSubscriptionsCollection();
  const notificationIds: ObjectId[] = [];

  try {
    const endpoints = [
      `https://push.example.test/${crypto.randomUUID()}`,
      `https://push.example.test/${crypto.randomUUID()}`,
    ];
    for (const endpoint of endpoints) {
      await savePushSubscription(created.account.id, {
        endpoint,
        expirationTime: null,
        keys: { p256dh: "mock-p256dh", auth: "mock-auth" },
      });
    }

    const partialDocument = buildNotificationDocument({
      requestId: crypto.randomUUID(),
      contactBookId,
      studentId,
      classDate: "2099-02-01",
      kind: "updated",
      requestedByRole: "admin",
      requestedByAccountId: null,
    });
    await notifications.insertOne(partialDocument);
    notificationIds.push(partialDocument._id);
    const firstCalls: string[] = [];
    const partial = await deliverContactBookNotification(
      partialDocument._id,
      async (subscription) => {
        firstCalls.push(subscription.endpoint);
        if (subscription.endpoint === endpoints[1]) {
          throw Object.assign(new Error("mock unavailable"), { statusCode: 503 });
        }
      },
    );
    assert(
      partial.status === "partial" && partial.sentCount === 1 && partial.failedCount === 1,
      "部分成功狀態不正確",
    );

    const retryCalls: string[] = [];
    const retried = await deliverContactBookNotification(
      partialDocument._id,
      async (subscription) => {
        retryCalls.push(subscription.endpoint);
      },
    );
    assert(
      retried.status === "sent" &&
        retried.sentCount === 2 &&
        retryCalls.length === 1 &&
        retryCalls[0] === endpoints[1],
      "重試應只發送先前失敗的裝置",
    );

    const expiredEndpoint = `https://push.example.test/${crypto.randomUUID()}`;
    await savePushSubscription(created.account.id, {
      endpoint: expiredEndpoint,
      expirationTime: null,
      keys: { p256dh: "mock-p256dh", auth: "mock-auth" },
    });
    const expiredDocument = buildNotificationDocument({
      requestId: crypto.randomUUID(),
      contactBookId,
      studentId,
      classDate: "2099-02-02",
      kind: "updated",
      requestedByRole: "admin",
      requestedByAccountId: null,
    });
    await notifications.insertOne(expiredDocument);
    notificationIds.push(expiredDocument._id);
    const expired = await deliverContactBookNotification(
      expiredDocument._id,
      async (subscription) => {
        if (subscription.endpoint === expiredEndpoint) {
          throw Object.assign(new Error("mock gone"), { statusCode: 410 });
        }
      },
    );
    assert(expired.status === "sent" && expired.sentCount === 2, "失效裝置不應拖累有效裝置狀態");
    assert(
      (await subscriptions.countDocuments({ studentId })) === 2 &&
        (await subscriptions.countDocuments({ endpoint: expiredEndpoint })) === 0,
      "410 失效訂閱未被移除",
    );

    console.log(JSON.stringify({
      success: true,
      partialStatus: partial.status,
      retryStatus: retried.status,
      retriedDeviceCount: retryCalls.length,
      expiredSubscriptionRemoved: true,
    }));
  } finally {
    const notificationResult = await notifications.deleteMany({ _id: { $in: notificationIds } });
    const subscriptionResult = await subscriptions.deleteMany({ studentId });
    const accounts = await getAccountsCollection();
    const accountResult = await accounts.deleteOne({ _id: studentId });
    assert(notificationResult.deletedCount === notificationIds.length, "通知測試資料清理失敗");
    assert(subscriptionResult.deletedCount >= 0, "訂閱測試資料清理失敗");
    assert(accountResult.deletedCount === 1, "帳號測試資料清理失敗");
  }

  const { getMongoClient } = await import("../lib/mongodb");
  await (await getMongoClient()).close();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "推播 E2E 測試失敗");
  try {
    const { getMongoClient } = await import("../lib/mongodb");
    await (await getMongoClient()).close();
  } catch {}
  process.exitCode = 1;
});
