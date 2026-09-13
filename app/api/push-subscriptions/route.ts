import { getAuthenticatedUser } from "@/lib/auth";
import {
  getPushSubscriptionCount,
  PushSubscriptionValidationError,
  removePushSubscription,
  savePushSubscription,
} from "@/models/PushSubscription";

function studentIdFrom(
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>,
) {
  return user.role === "student" ? user.id : null;
}
export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    const studentId = studentIdFrom(user);
    if (!studentId) {
      return Response.json({ error: "只有學生可以管理推播通知" }, { status: 403 });
    }
    const subscriptionCount = await getPushSubscriptionCount(studentId);
    return Response.json({ subscriptionCount });
  } catch (error) {
    console.error("讀取推播訂閱失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法讀取推播通知狀態" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    const studentId = studentIdFrom(user);
    if (!studentId) {
      return Response.json({ error: "只有學生可以開啟推播通知" }, { status: 403 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const result = await savePushSubscription(studentId, body);
    return Response.json(result, { status: result.updatedExisting ? 200 : 201 });
  } catch (error) {
    if (error instanceof PushSubscriptionValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("儲存推播訂閱失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法開啟推播通知" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    const studentId = studentIdFrom(user);
    if (!studentId) {
      return Response.json({ error: "只有學生可以關閉推播通知" }, { status: 403 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const result = await removePushSubscription(studentId, body.endpoint);
    return Response.json(result);
  } catch (error) {
    if (error instanceof PushSubscriptionValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("移除推播訂閱失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法關閉推播通知" }, { status: 500 });
  }
}
