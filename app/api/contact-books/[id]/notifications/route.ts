import { getAuthenticatedUser } from "@/lib/auth";
import {
  ContactBookValidationError,
  notifyContactBookUpdate,
} from "@/models/ContactBook";
import { ContactBookNotificationValidationError } from "@/models/ContactBookNotification";

function actorFrom(user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  return { role: user.role, accountId: user.role === "admin" ? null : user.id };
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "學生沒有發送通知的權限" }, { status: 403 });
    }
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const notification = await notifyContactBookUpdate(actorFrom(user), id, body.requestId);
    if (!notification) {
      return Response.json({ error: "找不到聯絡簿或沒有管理權限" }, { status: 404 });
    }
    return Response.json({ notification });
  } catch (error) {
    if (
      error instanceof ContactBookValidationError ||
      error instanceof ContactBookNotificationValidationError
    ) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("發送聯絡簿更新通知失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法通知學生更新" }, { status: 500 });
  }
}
