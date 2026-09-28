import { createExpensesPage } from "@waltersignal/bananaforce-module-expense/page";
import clientConfig from "../../client.config";
import { ensureStaffOrDemo } from "../../lib/staff-page";

export const dynamic = "force-dynamic";

const ExpensesPage = createExpensesPage(clientConfig);

export default async function GuardedExpensesPage() {
  await ensureStaffOrDemo();
  return <ExpensesPage />;
}
