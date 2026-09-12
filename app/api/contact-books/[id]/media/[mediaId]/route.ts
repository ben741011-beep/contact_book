import { del, issueSignedToken, presignUrl } from "@vercel/blob";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  ContactBookValidationError,
  findContactBookMedia,
  removeContactBookMedia,
} from "@/models/ContactBook";

function actorFrom(
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>,
) {
  return {
    role: user.role,
    accountId: user.role === "admin" ? null : user.id,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; mediaId: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    const { id, mediaId } = await context.params;
    const media = await findContactBookMedia(actorFrom(user), id, mediaId);
    if (!media) {
      return Response.json({ error: "找不到媒體或沒有查看權限" }, { status: 404 });
    }

    const validUntil = Date.now() + 5 * 60 * 1000;
    const token = await issueSignedToken({
      pathname: media.pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: "get",
      pathname: media.pathname,
      access: "private",
      validUntil,
    });
    return Response.redirect(presignedUrl, 307);
  } catch (error) {
    console.error("讀取聯絡簿媒體失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法讀取聯絡簿媒體" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; mediaId: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "學生沒有刪除媒體的權限" }, { status: 403 });
    }
    const { id, mediaId } = await context.params;
    const result = await removeContactBookMedia(actorFrom(user), id, mediaId);
    if (!result) {
      return Response.json({ error: "找不到媒體或沒有管理權限" }, { status: 404 });
    }

    let cleanupWarning: string | undefined;
    try {
      await del(result.media.pathname);
    } catch (error) {
      cleanupWarning = "聯絡簿已移除媒體，但 Blob 檔案清理失敗";
      console.error(cleanupWarning, error instanceof Error ? error.message : "未知錯誤");
    }
    return Response.json({ ...result, cleanupWarning });
  } catch (error) {
    if (error instanceof ContactBookValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("刪除聯絡簿媒體失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法刪除聯絡簿媒體" }, { status: 500 });
  }
}
