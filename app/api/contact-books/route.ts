import { getAuthenticatedUser } from "@/lib/auth";
import {
  ContactBookConflictError,
  ContactBookValidationError,
  createContactBook,
  listContactBooksFor,
} from "@/models/ContactBook";

function actorFrom(user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  return {
    role: user.role,
    accountId: user.role === "admin" ? null : user.id,
  };
}

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    const records = await listContactBooksFor(actorFrom(user));
    return Response.json({ records });
  } catch (error) {
    console.error("讀取聯絡簿失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法讀取聯絡簿" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "學生沒有新增聯絡簿的權限" }, { status: 403 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const result = await createContactBook(actorFrom(user), body);
    if (!result) {
      return Response.json({ error: "找不到學生或沒有管理權限" }, { status: 404 });
    }
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ContactBookValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ContactBookConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("新增聯絡簿失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法新增聯絡簿" }, { status: 500 });
  }
}
