import { head } from "@vercel/blob";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  CONTACT_BOOK_MEDIA_TYPES,
  ContactBookValidationError,
  MAX_CONTACT_BOOK_MEDIA_SIZE,
  addContactBookMedia,
} from "@/models/ContactBook";

function actorFrom(
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>,
) {
  return {
    role: user.role,
    accountId: user.role === "admin" ? null : user.id,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return Response.json({ error: "尚未登入" }, { status: 401 });
    if (user.role === "student") {
      return Response.json({ error: "學生沒有上傳媒體的權限" }, { status: 403 });
    }

    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const pathname = typeof body.pathname === "string" ? body.pathname : "";
    if (!pathname.startsWith(`contact-books/${id}/`)) {
      throw new ContactBookValidationError("媒體檔案與聯絡簿不相符");
    }

    const blob = await head(pathname);
    if (
      !CONTACT_BOOK_MEDIA_TYPES.includes(
        blob.contentType as (typeof CONTACT_BOOK_MEDIA_TYPES)[number],
      ) ||
      blob.size < 1 ||
      blob.size > MAX_CONTACT_BOOK_MEDIA_SIZE
    ) {
      throw new ContactBookValidationError("Blob 中的媒體格式或大小不正確");
    }

    const result = await addContactBookMedia(actorFrom(user), id, {
      pathname: blob.pathname,
      contentType: blob.contentType,
      size: blob.size,
      originalName: body.originalName,
    });
    if (!result) {
      return Response.json({ error: "找不到聯絡簿或沒有管理權限" }, { status: 404 });
    }
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ContactBookValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("新增聯絡簿媒體失敗", error instanceof Error ? error.message : "未知錯誤");
    return Response.json({ error: "無法新增聯絡簿媒體" }, { status: 500 });
  }
}
