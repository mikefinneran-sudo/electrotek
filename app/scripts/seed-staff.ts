/**
 * Bootstrap the ElectroTek staff allowlist.
 *
 * public.staff.id references auth.users(id), so a staff row cannot exist before
 * its auth user does -- there is no way to pre-seed the allowlist in a
 * migration. module-admin provisions staff through provisionStaffAction, but
 * that action calls requireStaff() and rejects anyone who is not already an
 * admin, so the FIRST admin can never be created through the UI. This script is
 * the bootstrap that breaks that cycle: it talks to the admin API with the
 * service-role key, which bypasses both RLS and the admin check.
 *
 * ElectroTek does not enable module-admin (that would mount inventory, orders
 * and catalog surfaces it has no use for), so re-running this script is also
 * how staff are managed until an admin surface is scoped for this client.
 *
 * Idempotent: an existing auth user is looked up rather than recreated, and the
 * staff row is upserted. Re-running never rotates a password.
 *
 * Usage, from the repo root, with apps/electrotek/.env.local populated:
 *
 *   pnpm --filter @waltersignal/bananaforce-electrotek seed:staff
 *
 * Temporary passwords are generated here and printed ONCE. They are not stored
 * anywhere. Everyone signs in with Google SSO in normal use; the password is
 * only a fallback so an account is reachable if SSO is misconfigured.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

interface StaffSeed {
  email: string;
  name: string | null;
  role: "staff" | "admin";
}

// Google Workspace serves electrotekconsultants.com (verified: MX ->
// ASPMX.L.GOOGLE.com), which is what makes Google SSO work for these accounts.
// electrotek.com is a different organisation on Microsoft 365 -- do not use it.
const STAFF: readonly StaffSeed[] = [
  { email: "rgf@electrotekconsultants.com", name: "Rosemary Finneran", role: "staff" },
  { email: "jmf@electrotekconsultants.com", name: "James M. Finneran", role: "staff" },
  { email: "jvm@electrotekconsultants.com", name: "James V. Miller", role: "staff" },
  { email: "kdm@electrotekconsultants.com", name: "Kristy Miller", role: "staff" },
  // Admin. This is deliberately an ElectroTek mailbox rather than a
  // waltersignal.io one: the Google OAuth consent screen is Internal, which
  // restricts sign-in to the electrotekconsultants.com Workspace org, so an
  // outside-domain admin could never actually sign in. WalterSignal operator
  // access runs through the service-role key, not a seeded login.
  { email: "mjf@electrotekconsultants.com", name: "Mike Finneran", role: "admin" },
];

function tempPassword(): string {
  // 24 url-safe chars. Comfortably over the 8-char floor provisionStaffAction
  // enforces and over Supabase's configured minimum.
  return randomBytes(18).toString("base64url");
}

async function findUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<User | null> {
  // listUsers is paginated and has no server-side email filter, so page until
  // the address turns up or the pages run out.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set. " +
        "Populate apps/electrotek/.env.local first.",
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const created: Array<{ email: string; password: string }> = [];

  for (const person of STAFF) {
    const email = person.email.toLowerCase();
    let user = await findUserByEmail(supabase, email);

    if (user) {
      console.log(`= ${email}: auth user already exists, leaving password alone`);
    } else {
      const password = tempPassword();
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`createUser failed for ${email}: ${error.message}`);
      user = data.user;
      if (!user) throw new Error(`createUser returned no user for ${email}`);
      created.push({ email, password });
      console.log(`+ ${email}: auth user created`);
    }

    const { error: staffError } = await supabase
      .from("staff")
      .upsert(
        { id: user.id, email, name: person.name, role: person.role },
        { onConflict: "id" },
      );
    if (staffError) {
      throw new Error(`staff upsert failed for ${email}: ${staffError.message}`);
    }
    console.log(`  staff row upserted as role=${person.role}`);
  }

  // Read the allowlist back rather than trusting the writes above.
  const { data: rows, error: readError } = await supabase
    .from("staff")
    .select("email, name, role")
    .order("role")
    .order("email");
  if (readError) throw new Error(`verification read failed: ${readError.message}`);

  console.log("\nstaff allowlist now holds:");
  for (const row of rows ?? []) {
    console.log(`  ${row.role.padEnd(5)} ${row.email}${row.name ? `  (${row.name})` : ""}`);
  }

  if (created.length > 0) {
    console.log("\nTemporary passwords -- shown once, not stored. Hand these over securely:");
    for (const row of created) console.log(`  ${row.email}  ${row.password}`);
    console.log("\nNormal sign-in is Google SSO; these are only an SSO-failure fallback.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
