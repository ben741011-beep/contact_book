import { getAuthenticatedUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    return Response.json({ user });
  } catch (error) {
    console.error("讀取登入狀態失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法讀取登入狀態" }, { status: 500 });
  }
}
