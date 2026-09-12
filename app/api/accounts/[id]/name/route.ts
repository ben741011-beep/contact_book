import { getAuthenticatedUser } from "@/lib/auth";
import {
  AccountValidationError,
  updateAccountName,
} from "@/models/Account";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "沒有設定姓名的權限" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await updateAccountName(
      {
        role: user.role,
        accountId: user.role === "teacher" ? user.id : null,
      },
      id,
      body.name,
    );
    if (!result) {
      return Response.json({ error: "找不到帳號或沒有修改權限" }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof AccountValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("設定姓名失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法設定姓名" }, { status: 500 });
  }
}
