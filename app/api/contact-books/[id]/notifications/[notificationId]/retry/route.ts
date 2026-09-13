import { ObjectId } from "mongodb";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  ContactBookValidationError,
  findManageableContactBook,
} from "@/models/ContactBook";
import {
  ContactBookNotificationValidationError,
  deliverContactBookNotification,
  findNotificationForContactBook,
} from "@/models/ContactBookNotification";

function actorFrom(user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  return { role: user.role, accountId: user.role === "admin" ? null : user.id };
}
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; notificationId: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "學生沒有重試通知的權限" }, { status: 403 });
    }
    const { id, notificationId } = await context.params;
    const record = await findManageableContactBook(actorFrom(user), id);
    if (!record) {
      return Response.json({ error: "找不到聯絡簿或沒有管理權限" }, { status: 404 });
    }
    const notification = await findNotificationForContactBook(
      notificationId,
      new ObjectId(id),
    );
    if (!notification) {
      return Response.json({ error: "找不到可重試的通知" }, { status: 404 });
    }
    const updated = await deliverContactBookNotification(notification._id);
    return Response.json({ notification: updated });
  } catch (error) {
    if (
      error instanceof ContactBookValidationError ||
      error instanceof ContactBookNotificationValidationError
    ) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("重試聯絡簿通知失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法重試通知" }, { status: 500 });
  }
}
