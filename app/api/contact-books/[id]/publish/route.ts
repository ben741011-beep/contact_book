import { getAuthenticatedUser } from "@/lib/auth";
import {
  ContactBookConflictError,
  ContactBookValidationError,
  publishContactBook,
} from "@/models/ContactBook";
import { ContactBookNotificationValidationError } from "@/models/ContactBookNotification";

function actorFrom(user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  return { role: user.role, accountId: user.role === "admin" ? null : user.id };
}
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "學生沒有發布聯絡簿的權限" }, { status: 403 });
    }
    const { id } = await context.params;
    const result = await publishContactBook(actorFrom(user), id);
    if (!result) {
      return Response.json({ error: "找不到聯絡簿或沒有管理權限" }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    if (
      error instanceof ContactBookValidationError ||
      error instanceof ContactBookNotificationValidationError
    ) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ContactBookConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("發布聯絡簿失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法發布聯絡簿" }, { status: 500 });
  }
}
