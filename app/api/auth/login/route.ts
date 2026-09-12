import { login } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const user = await login(body.username, body.password);
    if (!user) {
      return Response.json({ error: "帳號或密碼錯誤" }, { status: 401 });
    }
    return Response.json({ user });
  } catch (error) {
    console.error("登入失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "登入服務暫時無法使用" }, { status: 500 });
  }
}
