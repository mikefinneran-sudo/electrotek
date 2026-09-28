import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowIcon, ModuleIcon } from "./module-icon";
import type { ModuleFeature } from "../lib/module-features";

export function ModuleTile({
  feature,
  href,
  size = "default",
}: {
  feature: ModuleFeature;
  href: string;
  size?: "default" | "large";
}) {
  return (
    <Link href={href} className={`tile ${size === "large" ? "tile-lg" : ""}`}>
      <span className="tile-icon">
        <ModuleIcon name={feature.icon} />
      </span>
      <span className="tile-body">
        <span className="tile-title">{feature.title}</span>
        <span className="tile-desc">{feature.blurb}</span>
      </span>
      <ArrowIcon className="tile-arrow" />
    </Link>
  );
}

export function ModuleRow({
  feature,
  href,
  locked = false,
}: {
  feature: ModuleFeature;
  href?: string;
  locked?: boolean;
}) {
  if (locked || !href) {
    return (
      <div className="module-row module-row-locked" aria-disabled="true">
        <span className="module-row-icon">
          <ModuleIcon name={feature.icon} />
        </span>
        <span className="module-row-main">
          <span className="module-row-title">{feature.title}</span>
          <span className="module-row-desc">{feature.blurb}</span>
        </span>
        <span className="module-row-badge">Locked</span>
      </div>
    );
  }

  return (
    <Link href={href} className="module-row">
      <span className="module-row-icon">
        <ModuleIcon name={feature.icon} />
      </span>
      <span className="module-row-main">
        <span className="module-row-title">{feature.title}</span>
        <span className="module-row-desc">{feature.blurb}</span>
      </span>
      <ArrowIcon className="module-row-arrow" />
    </Link>
  );
}

export function ModuleGroupPanel({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="panel-group">
      <header className="panel-group-head">
        <h2>{label}</h2>
        <p>{description}</p>
      </header>
      <div className="module-rows">{children}</div>
    </section>
  );
}
