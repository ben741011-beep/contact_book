import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  CONTACT_BOOK_MEDIA_TYPES,
  MAX_CONTACT_BOOK_MEDIA_SIZE,
  getContactBookMediaPathPrefix,
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
    const body = (await request.json()) as HandleUploadPresignedBody;
    const { id } = await context.params;
    const authorizedUser =
      body.type === "blob.generate-presigned-url"
        ? await getAuthenticatedUser()
        : null;
    if (body.type === "blob.generate-presigned-url" && !authorizedUser) {
      return Response.json({ error: "尚未登入" }, { status: 401 });
    }
    const expectedPathPrefix = authorizedUser
      ? await getContactBookMediaPathPrefix(actorFrom(authorizedUser), id)
      : null;
    if (authorizedUser && !expectedPathPrefix) {
      return Response.json(
        { error: "找不到聯絡簿或沒有上傳權限" },
        { status: 404 },
      );
    }

    const response = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        if (!authorizedUser || !expectedPathPrefix) throw new Error("尚未登入");
        if (!pathname.startsWith(expectedPathPrefix)) {
          throw new Error("媒體檔案路徑不正確");
        }

        const validUntil = Date.now() + 10 * 60 * 1000;
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: [...CONTACT_BOOK_MEDIA_TYPES],
          maximumSizeInBytes: MAX_CONTACT_BOOK_MEDIA_SIZE,
          validUntil,
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes: [...CONTACT_BOOK_MEDIA_TYPES],
            maximumSizeInBytes: MAX_CONTACT_BOOK_MEDIA_SIZE,
            validUntil,
            addRandomSuffix: true,
          },
        };
      },
    });

    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法取得上傳權限";
    const status = message === "尚未登入" ? 401 : 400;
    return Response.json({ error: message }, { status });
  }
}
