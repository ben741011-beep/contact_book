import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  findAccountById,
  findAccountForLogin,
  parsePhone,
  verifyAccountPassword,
  type SessionRole,
} from "@/models/Account";
import { createSession, readSession } from "@/lib/session";

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: SessionRole;
  name: string | null;
}

function adminCredentials() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) throw new Error("管理員環境變數尚未設定");
  return { username, password };
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export async function login(usernameInput: unknown, passwordInput: unknown) {
  const username = typeof usernameInput === "string" ? usernameInput.trim() : "";
  const password = typeof passwordInput === "string" ? passwordInput : "";
  if (!username || !password) return null;

  const admin = adminCredentials();
  if (
    constantTimeEqual(username, admin.username) &&
    constantTimeEqual(password, admin.password)
  ) {
    const user: AuthenticatedUser = {
      id: "admin",
      username: admin.username,
      role: "admin",
      name: "管理者",
    };
    await createSession({ username, role: "admin", accountId: null });
    return user;
  }

  let phone: string;
  try {
    phone = parsePhone(username);
  } catch {
    return null;
  }

  const account = await findAccountForLogin(phone);
  if (!account || !(await verifyAccountPassword(account, password))) return null;

  const user: AuthenticatedUser = {
    id: account._id.toHexString(),
    username: account.phone,
    role: account.role,
    name: account.name,
  };
  await createSession({
    username: account.phone,
    role: account.role,
    accountId: user.id,
  });
  return user;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const session = await readSession();
  if (!session) return null;

  if (session.role === "admin") {
    const admin = adminCredentials();
    if (session.accountId !== null || session.username !== admin.username) return null;
    return {
      id: "admin",
      username: admin.username,
      role: "admin",
      name: "管理者",
    };
  }

  if (!session.accountId) return null;
  const account = await findAccountById(session.accountId);
  if (!account || account.phone !== session.username || account.role !== session.role) {
    return null;
  }

  return {
    id: account._id.toHexString(),
    username: account.phone,
    role: account.role,
    name: account.name,
  };
}
