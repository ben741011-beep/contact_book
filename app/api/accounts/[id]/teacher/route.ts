import { getAuthenticatedUser } from "@/lib/auth";
import {
  AccountValidationError,
  assignStudentToTeacher,
} from "@/models/Account";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role !== "admin") {
      return Response.json({ error: "只有管理者可以指派學生" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await assignStudentToTeacher(
      { role: "admin", accountId: null },
      id,
      body.teacherId,
    );
    if (!result) {
      return Response.json({ error: "找不到學生帳號" }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof AccountValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("指派學生失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法指派學生" }, { status: 500 });
  }
}
