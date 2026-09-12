import { getAuthenticatedUser } from "@/lib/auth";
import {
  AccountConflictError,
  AccountValidationError,
  createAccount,
  listAccountsFor,
} from "@/models/Account";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "沒有查看帳號的權限" }, { status: 403 });
    }

    const accounts = await listAccountsFor({
      role: user.role,
      accountId: user.role === "teacher" ? user.id : null,
    });
    return Response.json({ accounts });
  } catch (error) {
    console.error("讀取帳號失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法讀取帳號" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "沒有建立帳號的權限" }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    if (user.role === "teacher" && body.role !== "student") {
      return Response.json({ error: "老師只能建立學生帳號" }, { status: 403 });
    }
    const result = await createAccount(
      {
        role: user.role,
        accountId: user.role === "teacher" ? user.id : null,
      },
      { phone: body.phone, role: body.role },
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AccountValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AccountConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("建立帳號失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法建立帳號" }, { status: 500 });
  }
}
