import { createCaseFilePage } from "@waltersignal/bananaforce-module-forensic-case/page";
import clientConfig from "../../client.config";
import { ensureStaffOrDemo } from "../../lib/staff-page";

export const dynamic = "force-dynamic";

const CaseFilePage = createCaseFilePage(clientConfig);

export default async function GuardedCaseFilePage() {
  await ensureStaffOrDemo();
  return <CaseFilePage />;
}
