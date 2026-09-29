import type { ClientModule, ModuleMount } from "@waltersignal/bananaforce-core";

export const EXPENSE_MODULE_ID = "expense";

export const expenseModule = {
  id: EXPENSE_MODULE_ID,
  name: "Expenses",
  description:
    "Receipt capture with AI-proposed fields, operator confirmation, and ledger export.",
  routes: ["/expenses", "/api/expenses"],
  dataAdapters: ["supabase"],
  audience: "staff",
} satisfies ClientModule;

export const expenseMounts = [
  {
    moduleId: EXPENSE_MODULE_ID,
    kind: "page",
    route: "/expenses",
    appFile: "app/expenses/page.tsx",
    entrypoint: "@waltersignal/bananaforce-module-expense/page",
  },
  {
    moduleId: EXPENSE_MODULE_ID,
    kind: "route",
    route: "/api/expenses",
    appFile: "app/api/expenses/route.ts",
    entrypoint: "@waltersignal/bananaforce-module-expense/routes",
    // No POST: draft creation goes through the upload Server Action, which
    // handles the multipart body. check-mounts compares this against what
    // routes.ts actually exports, so the two must agree.
    methods: ["GET", "PATCH"],
  },
] as const satisfies readonly ModuleMount[];

export const moduleMounts = expenseMounts;

export type {
  ConfirmExpenseInput,
  Expense,
  ExpenseCategory,
  ExpenseDraftInput,
  ExpenseReceipt,
  ExpenseStatus,
  ExpenseSubjectType,
} from "./types";
export { EXPENSE_STATUSES } from "./types";
