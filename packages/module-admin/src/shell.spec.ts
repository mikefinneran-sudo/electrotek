import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminNavItem } from "./nav";
import { AdminShell } from "./shell";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/crm" }));

vi.mock("./sign-out", () => ({
  SignOutButton: () => createElement("button", { type: "button" }, "Sign out"),
}));

vi.mock("./actions", () => ({ saveNavLayout: vi.fn() }));

function renderShell(navItems: AdminNavItem[], canCustomize = false) {
  return renderToStaticMarkup(
    createElement(
      AdminShell,
      {
        brandName: "Acme",
        navItems,
        staffEmail: "s@example.com",
        staffName: null,
        staffRole: "admin",
        canCustomize,
        children: createElement("p", null, "Content"),
      },
    ),
  );
}

describe("AdminShell renamed nav labels (WAL-1078)", () => {
  const navItems: AdminNavItem[] = [
    {
      href: "/crm",
      label: "Pipeline",
      defaultLabel: "CRM",
      requires: ["crm"],
    },
    {
      href: "/expenses",
      label: "Expenses",
      defaultLabel: "Expenses",
      requires: ["expense"],
    },
  ];

  it("shows the renamed label in desktop and mobile nav, not the default", () => {
    const html = renderShell(navItems);

    expect(html).toContain('class="admin-nav"');
    expect(html).toContain('class="admin-mobile-nav"');
    expect(html.match(/Pipeline/g)?.length).toBe(2);
    expect(html).not.toMatch(/>(CRM)</);
  });

  it("renders no arrange control when canCustomize is false", () => {
    const html = renderShell(navItems, false);
    expect(html).not.toContain("Customize");
  });
});