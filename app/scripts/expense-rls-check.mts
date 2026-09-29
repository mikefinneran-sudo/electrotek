// Exercises migration 0067 against a LOCAL Supabase: ownership, report locking,
// segregation of duties, mileage pricing, and receipt-folder isolation.
// Never point this at a client project: it creates auth users.
//
//   SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//     pnpm --filter @waltersignal/bananaforce-electrotek exec tsx scripts/expense-rls-check.mts
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "";
const anon = process.env.SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error("Local Supabase only.");

const admin = createClient(url, service, { auth: { persistSession: false } });
const PASSWORD = "local-only-password-1";
let passed = 0;
const ok = (cond: unknown, msg: string) => { assert(cond, msg); passed += 1; console.log("  ok -", msg); };

async function user(email: string, role: "staff" | "approver", name: string): Promise<{ id: string; db: SupabaseClient }> {
  const existing = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email);
  const id = existing?.id ?? (await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })).data.user!.id;
  await admin.from("staff").upsert({ id, email, name, role });
  const db = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { id, db };
}

const inv = await user("inv1@example.test", "staff", "Investigator One");
const other = await user("inv2@example.test", "staff", "Investigator Two");
const approver = await user("approver@example.test", "approver", "Approver");

const { data: cats } = await inv.db.from("expense_categories").select("id,name,per_mile").order("sort_order");
ok((cats ?? []).length >= 14 && cats![0].name === "Mileage" && cats![0].per_mile, "seeded categories visible to staff, Mileage first and per-mile");

const { data: rate } = await inv.db.rpc("expense_mileage_rate_on", { p_date: "2026-08-03" });
ok(Number(rate) === 0.76, "mileage rate on 2026-08-03 is 0.76");
const { data: rateJan } = await inv.db.rpc("expense_mileage_rate_on", { p_date: "2026-03-01" });
ok(Number(rateJan) === 0.725, "mileage rate on 2026-03-01 is 0.725");

// Entries
const hotel = await inv.db.from("expenses").insert({ status: "confirmed", vendor: "Hampton Inn", purchased_on: "2026-08-03", total: 142.5, currency: "usd", confirmed_at: new Date().toISOString(), confirmed_by: inv.id }).select("id,submitted_by").single();
ok(!hotel.error && hotel.data!.submitted_by === inv.id, "investigator creates an expense owned by themself");

// The caller's total and rate are ignored: the database prices mileage.
const miles = await inv.db.from("expenses").insert({ status: "confirmed", vendor: "Office to scene", purchased_on: "2026-08-03", total: 999, miles: 100, mileage_rate: 5, confirmed_at: new Date().toISOString(), confirmed_by: inv.id }).select("id,total,mileage_rate").single();
ok(!miles.error && Number(miles.data!.total) === 76 && Number(miles.data!.mileage_rate) === 0.76, "mileage priced by the database at 100 mi x 0.76 = 76.00, caller's rate ignored");
const half = await inv.db.from("expenses").insert({ status: "confirmed", vendor: "Office to lab", purchased_on: "2026-03-02", total: 0, miles: 1, confirmed_at: new Date().toISOString(), confirmed_by: inv.id }).select("id,total").single();
ok(Number(half.data!.total) === 0.73, "1 mi x 0.725 rounds half-up to 0.73 (numeric, not float)");
await inv.db.from("expenses").delete().eq("id", half.data!.id);
const early2024 = await inv.db.from("expenses").insert({ vendor: "x", purchased_on: "2024-06-01", total: 0, miles: 10 });
ok(early2024.error?.message.includes("No mileage rate"), "mileage before the first rate on file is refused");

const spoof = await inv.db.from("expenses").insert({ vendor: "x", submitted_by: other.id });
ok(spoof.error, "cannot create an expense owned by someone else");

const peek = await other.db.from("expenses").select("id").eq("id", hotel.data!.id);
ok((peek.data ?? []).length === 0, "another investigator cannot see my expense");
const peekAdmin = await approver.db.from("expenses").select("id").eq("id", hotel.data!.id);
ok((peekAdmin.data ?? []).length === 1, "approver can see my expense");
const tamper = await other.db.from("expenses").update({ total: 1 }).eq("id", hotel.data!.id).select("id");
ok((tamper.data ?? []).length === 0, "another investigator cannot change my expense");

// Report
const rep = await inv.db.from("expense_reports").insert({ title: "Gray IN scene, Aug 2026" }).select("*").single();
ok(!rep.error && rep.data!.status === "open" && rep.data!.submitted_by === inv.id, "investigator opens a report");
const forge = await inv.db.from("expense_reports").insert({ title: "x", status: "approved" });
ok(forge.error, "cannot create a report already approved");
const selfApprove = await inv.db.from("expense_reports").update({ status: "approved" }).eq("id", rep.data!.id);
ok(selfApprove.error, "cannot set report status with a plain update");
const forgeNote = await inv.db.from("expense_reports").update({ decision_note: "ok", decided_by: approver.id }).eq("id", rep.data!.id);
ok(forgeNote.error, "cannot write decision fields on my own report");

const emptySubmit = await inv.db.rpc("expense_report_submit", { p_report: rep.data!.id });
ok(emptySubmit.error?.message.includes("at least one"), "empty report cannot be submitted");

const attach = await inv.db.from("expenses").update({ report_id: rep.data!.id }).in("id", [hotel.data!.id, miles.data!.id]).select("id");
ok(attach.data?.length === 2, "expenses added to the report");

const draft = await inv.db.rpc("expense_create_draft", { p_draft: { vendor: null, currency: "usd", field_confidence: {} }, p_receipt: { storage_path: `${inv.id}/2026-08/r1`, media_type: "image/jpeg", extracted_at: null } });
ok(!draft.error, "draft + receipt created atomically");
const badDraft = await inv.db.rpc("expense_create_draft", { p_draft: { vendor: null, currency: "usd" }, p_receipt: { storage_path: null, media_type: "image/jpeg" } });
const orphan = await inv.db.from("expenses").select("id").eq("status", "draft");
ok(badDraft.error && orphan.data!.length === 1, "failed receipt insert leaves no orphan draft");
await inv.db.from("expenses").update({ report_id: rep.data!.id }).eq("id", draft.data);
const draftSubmit = await inv.db.rpc("expense_report_submit", { p_report: rep.data!.id });
ok(draftSubmit.error?.message.includes("need review"), "report with an unreviewed draft cannot be submitted");
await inv.db.from("expenses").delete().eq("id", draft.data);

const submit = await inv.db.rpc("expense_report_submit", { p_report: rep.data!.id });
ok(!submit.error, "report submitted");
const locked = await inv.db.from("expenses").update({ total: 1 }).eq("id", hotel.data!.id).select("id");
ok((locked.data ?? []).length === 0, "submitted report locks its expenses");
const sneak = await inv.db.from("expenses").insert({ vendor: "late", report_id: rep.data!.id });
ok(sneak.error, "cannot add to a submitted report");

const own = await approver.db.from("expense_reports").insert({ title: "Approver trip" }).select("id").single();
const ownExp = await approver.db.from("expenses").insert({ status: "confirmed", vendor: "Delta", purchased_on: "2026-08-01", total: 300, report_id: own.data!.id, confirmed_at: new Date().toISOString(), confirmed_by: approver.id });
ok(!ownExp.error, "approver files their own expense");
await approver.db.rpc("expense_report_submit", { p_report: own.data!.id });
const selfDecide = await approver.db.rpc("expense_report_decide", { p_report: own.data!.id, p_approve: true });
ok(selfDecide.error?.message.includes("your own"), "approver cannot approve their own report");

const staffDecide = await other.db.rpc("expense_report_decide", { p_report: rep.data!.id, p_approve: true });
ok(staffDecide.error, "non-approver cannot decide");
const noReason = await approver.db.rpc("expense_report_decide", { p_report: rep.data!.id, p_approve: false, p_note: " " });
ok(noReason.error, "rejection requires a reason");
const reject = await approver.db.rpc("expense_report_decide", { p_report: rep.data!.id, p_approve: false, p_note: "Hotel needs an itemised folio." });
ok(!reject.error, "approver sends the report back");
const fix = await inv.db.from("expenses").update({ total: 138.2 }).eq("id", hotel.data!.id).select("id");
ok(fix.data?.length === 1, "rejected report is editable again");
await inv.db.rpc("expense_report_submit", { p_report: rep.data!.id });
const early = await approver.db.rpc("expense_report_mark_reimbursed", { p_report: rep.data!.id });
ok(early.error, "cannot reimburse before approval");
const approve = await approver.db.rpc("expense_report_decide", { p_report: rep.data!.id, p_approve: true, p_note: null });
ok(!approve.error, "approver approves");
const paid = await approver.db.rpc("expense_report_mark_reimbursed", { p_report: rep.data!.id });
ok(!paid.error, "approver marks reimbursed");
const final = await inv.db.from("expense_reports").select("status,decided_by,reimbursed_by").eq("id", rep.data!.id).single();
ok(final.data!.status === "reimbursed" && final.data!.decided_by === approver.id, "report ends reimbursed with the approver recorded");
const deleteLocked = await inv.db.from("expenses").delete().eq("id", hotel.data!.id).select("id");
ok((deleteLocked.data ?? []).length === 0, "reimbursed expenses cannot be deleted");

// Receipt folder isolation
const png = new Uint8Array([137, 80, 78, 71]);
const up = await inv.db.storage.from("expense-receipts").upload(`${inv.id}/2026-08/check-${Date.now()}`, png, { contentType: "image/png" });
ok(!up.error, "investigator uploads into their own folder");
const upOther = await inv.db.storage.from("expense-receipts").upload(`${other.id}/2026-08/x-${Date.now()}`, png, { contentType: "image/png" });
ok(upOther.error, "investigator cannot upload into someone else's folder");
const signOther = await other.db.storage.from("expense-receipts").createSignedUrl(up.data!.path, 60);
ok(signOther.error, "another investigator cannot read my receipt");
const signAdmin = await approver.db.storage.from("expense-receipts").createSignedUrl(up.data!.path, 60);
ok(!signAdmin.error, "approver can read my receipt");

// 'approver' decides reports; it must not inherit admin's staff management.
const promote = await approver.db.from("staff").update({ role: "admin" }).eq("id", other.id).select("id");
ok((promote.data ?? []).length === 0, "an approver cannot change staff roles");

console.log(`\n${passed} checks passed`);
