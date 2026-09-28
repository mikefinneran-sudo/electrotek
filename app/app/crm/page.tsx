import { redirect } from "next/navigation";
import { ensureStaffOrDemo } from "../../lib/staff-page";

export const dynamic = "force-dynamic";

// ElectroTek runs module-forensic-case: the case file IS the CRM workspace
// for this client, so /crm is not a second workspace -- it just forwards
// staff to /cases. See packages/module-admin/src/nav.ts.
export default async function CrmRedirectPage() {
  await ensureStaffOrDemo();
  redirect("/cases");
}
