import { createExpensesPage } from "@waltersignal/bananaforce-module-expense/page";
import clientConfig from "../../client.config";
import { ensureStaffOrDemo } from "../../lib/staff-page";

export const dynamic = "force-dynamic";

const ExpensesPage = createExpensesPage(clientConfig);

export default async function GuardedExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ensureStaffOrDemo();
  return <ExpensesPage searchParams={searchParams} />;
}
