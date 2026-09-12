import { getAuthenticatedUser } from "@/lib/auth";
import {
  ContactBookConflictError,
  ContactBookValidationError,
  deleteContactBook,
  updateStudentComment,
  updateContactBook,
} from "@/models/ContactBook";

function actorFrom(user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  return {
    role: user.role,
    accountId: user.role === "admin" ? null : user.id,
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result =
      user.role === "student"
        ? await updateStudentComment(actorFrom(user), id, body)
        : await updateContactBook(actorFrom(user), id, body);
    if (!result) {
      return Response.json({ error: "找不到聯絡簿或沒有管理權限" }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof ContactBookValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ContactBookConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("修改聯絡簿失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法修改聯絡簿" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "學生沒有刪除聯絡簿的權限" }, { status: 403 });
    }
    const { id } = await context.params;
    const result = await deleteContactBook(actorFrom(user), id);
    if (!result) {
      return Response.json({ error: "找不到聯絡簿或沒有管理權限" }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof ContactBookValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("刪除聯絡簿失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法刪除聯絡簿" }, { status: 500 });
  }
}
