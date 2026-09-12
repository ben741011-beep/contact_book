import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth";
import { listAccountsFor } from "@/models/Account";
import { listContactBooksFor } from "@/models/ContactBook";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const actor = {
    role: user.role,
    accountId: user.role === "admin" ? null : user.id,
  };
  const [accounts, contactBooks] = await Promise.all([
    user.role === "student"
      ? Promise.resolve([])
      : listAccountsFor({
          role: user.role,
          accountId: user.role === "teacher" ? user.id : null,
        }),
    listContactBooksFor(actor),
  ]);

  return (
    <DashboardClient
      user={user}
      initialAccounts={accounts}
      initialContactBooks={contactBooks}
    />
  );
}
