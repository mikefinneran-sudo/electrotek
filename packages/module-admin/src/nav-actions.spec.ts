// WAL-1078: saveNavLayout gate, persistence, and audit.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NAV_LAYOUT_KEY,
  applyNavLayout,
  parseNavLayout,
  resolveStaffNav,
} from "./nav";

const requireStaff = vi.fn();
const upsert = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const from = vi.fn();
const recordAudit = vi.fn();
const revalidatePath = vi.fn();

vi.mock("./auth", () => ({ requireStaff: () => requireStaff() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@waltersignal/bananaforce-data-supabase/audit", () => ({ recordAudit }));
vi.mock("@waltersignal/bananaforce-data-supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock("@waltersignal/bananaforce-data-supabase/server", () => ({
  getSupabaseServerClient: async () => ({ from }),
}));

const { saveNavLayout } = await import("./actions");

const modules = ["admin", "crm", "expense"] as const;
const baseNav = resolveStaffNav([...modules]);

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue({ select, upsert });
  select.mockReturnValue({ eq });
  eq.mockReturnValue({ maybeSingle });
  maybeSingle.mockResolvedValue({ data: null });
  upsert.mockResolvedValue({ error: null });
  requireStaff.mockResolvedValue({
    id: "admin-1",
    email: "a@example.com",
    role: "admin",
  });
});

describe("saveNavLayout", () => {
  it("rejects non-admin staff without writing or auditing", async () => {
    requireStaff.mockResolvedValueOnce({
      id: "staff-1",
      email: "s@example.com",
      role: "staff",
    });

    const result = await saveNavLayout({ order: ["/crm"], labels: {} });

    expect(result).toEqual({ error: "Only admins can customize the sidebar." });
    expect(from).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("upserts staff.nav for admins and records staff_nav.updated", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { value: { order: ["/expenses"], labels: { "/crm": "Old" } } },
    });

    const result = await saveNavLayout({
      order: ["/crm", "/admin"],
      labels: { "/crm": "Pipeline" },
    });

    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    const row = upsert.mock.calls[0]![0];
    expect(row.key).toBe(NAV_LAYOUT_KEY);
    expect(row.value).toEqual({
      order: ["/crm", "/admin", "/expenses"],
      labels: { "/crm": "Pipeline" },
    });
    expect(upsert.mock.calls[0]![1]).toEqual({ onConflict: "key" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "staff_nav.updated",
        resource_type: "site_content",
        resource_id: NAV_LAYOUT_KEY,
        actor_id: "admin-1",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("reorder persists: saved value round-trips through parseNavLayout + applyNavLayout", async () => {
    const order = ["/expenses", "/crm", "/admin"];

    await saveNavLayout({ order, labels: {} });

    const saved = upsert.mock.calls[0]![0].value;
    const layout = parseNavLayout(saved);
    expect(layout).not.toBeNull();
    const nav = applyNavLayout(baseNav, layout);
    expect(nav.map((i) => i.href).slice(0, order.length)).toEqual(order);
  });

  it("returns an error when upsert fails and does not audit", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "denied" } });

    const result = await saveNavLayout({ order: ["/crm"], labels: { "/crm": "Pipeline" } });

    expect(result).toEqual({ error: "Could not save the sidebar. Try again." });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});