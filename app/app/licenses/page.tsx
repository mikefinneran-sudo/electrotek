import { createLicensesPage } from "@waltersignal/bananaforce-module-licensing/page";
import clientConfig from "../../client.config";
import { ensureStaffOrDemo } from "../../lib/staff-page";

export const dynamic = "force-dynamic";

const LicensesPage = createLicensesPage(clientConfig);

export default async function GuardedLicensesPage() {
  await ensureStaffOrDemo();
  return <LicensesPage />;
}
