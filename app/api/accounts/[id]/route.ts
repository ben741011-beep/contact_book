import { getAuthenticatedUser } from "@/lib/auth";
import {
  AccountValidationError,
  deleteAccount,
} from "@/models/Account";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "沒有刪除帳號的權限" }, { status: 403 });
    }

    const { id } = await context.params;
    const result = await deleteAccount(
      {
        role: user.role,
        accountId: user.role === "teacher" ? user.id : null,
      },
      id,
    );

    if (!result) {
      return Response.json({ error: "找不到帳號或沒有刪除權限" }, { status: 404 });
    }

    return Response.json(result);
  } catch (error) {
    if (error instanceof AccountValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("刪除帳號失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法刪除帳號" }, { status: 500 });
  }
}
