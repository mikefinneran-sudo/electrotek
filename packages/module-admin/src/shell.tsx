"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminNavItem } from "./nav";
import { SignOutButton } from "./sign-out";

export interface AdminShellProps {
  brandName: string;
  navItems: AdminNavItem[];
  staffEmail: string;
  staffName: string | null;
  staffRole: string;
  children: React.ReactNode;
}

export function AdminShell({
  brandName,
  navItems,
  staffEmail,
  staffName,
  staffRole,
  children,
}: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/admin" className="admin-brand">
          {brandName}
          <span className="admin-brand-sub">Back office</span>
        </Link>
        <nav className="admin-nav">
          {navItems.map((item) => {
            const active = "exact" in item && item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-link${active ? " active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="admin-sidebar-foot">
          <span className="admin-user">
            {staffName || staffEmail}
            {staffRole === "admin" ? <span className="admin-role"> · admin</span> : null}
          </span>
          <SignOutButton />
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-mobile-bar">
          <Link href="/admin" className="admin-brand compact">
            {brandName}
          </Link>
          <SignOutButton />
        </header>
        <nav className="admin-mobile-nav">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="admin-nav-link">
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
