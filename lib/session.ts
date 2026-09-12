import "server-only";

import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

import type { SessionRole } from "@/models/Account";

export const SESSION_COOKIE = "teacher_contact_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  username: string;
  role: SessionRole;
  accountId: string | null;
}

function getSessionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET 必須設定且至少 32 個字元");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT({
    username: payload.username,
    role: payload.role,
    accountId: payload.accountId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.accountId ?? "admin")
    .setIssuer("teacher-contact-book")
    .setAudience("teacher-contact-book-web")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSessionKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSessionKey(), {
      issuer: "teacher-contact-book",
      audience: "teacher-contact-book-web",
    });

    if (
      typeof payload.username !== "string" ||
      (payload.role !== "admin" &&
        payload.role !== "teacher" &&
        payload.role !== "student") ||
      (payload.accountId !== null && typeof payload.accountId !== "string")
    ) {
      return null;
    }

    return {
      username: payload.username,
      role: payload.role,
      accountId: payload.accountId,
    };
  } catch {
    return null;
  }
}

export async function deleteSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
