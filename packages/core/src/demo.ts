import type { ClientConfig } from "./types";

export interface DemoInstanceConfig extends ClientConfig {
  marketing: {
    eyebrow: string;
    headline: string;
    body: string;
    primaryCta: { label: string; href: string };
    secondaryCta: { label: string; href: string };
  };
  seedProfile: string;
  seededStaff: {
    email: string;
    name: string;
    role: "admin" | "staff";
  };
}

export interface DemoRegistryEntry {
  slug: string;
  projectRef: string;
  owner: string;
  client: string;
  expiresAt: string;
}

export type LoadDemoInstanceOptions = {
  slug: string | undefined;
  config: DemoInstanceConfig;
  registry: readonly DemoRegistryEntry[];
  production?: boolean;
  now?: Date;
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER_REF_PATTERN = /^(?:placeholder(?:-|$)|your-project-ref$)/i;

export function isDemo(): boolean {
  return Boolean(process.env.DEMO_SLUG?.trim());
}

export function isPlaceholderProjectRef(projectRef: string): boolean {
  return PLACEHOLDER_REF_PATTERN.test(projectRef);
}

export function loadDemoInstance({
  slug,
  config,
  registry,
  production = false,
  now = new Date(),
}: LoadDemoInstanceOptions): DemoInstanceConfig {
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid demo slug: ${slug ?? "(missing)"}`);
  }

  const slugs = new Set<string>();
  const refs = new Set<string>();
  for (const candidate of registry) {
    if (!SLUG_PATTERN.test(candidate.slug)) {
      throw new Error(`Invalid registry demo slug: ${candidate.slug}`);
    }
    if (slugs.has(candidate.slug)) {
      throw new Error(`Duplicate demo slug: ${candidate.slug}`);
    }
    if (refs.has(candidate.projectRef)) {
      throw new Error(`Duplicate demo project ref: ${candidate.projectRef}`);
    }
    slugs.add(candidate.slug);
    refs.add(candidate.projectRef);
  }

  const entry = registry.find((candidate) => candidate.slug === slug);
  if (!entry) throw new Error(`Unknown demo slug: ${slug}`);
  if (config.slug !== entry.slug) {
    throw new Error(`Demo config slug does not match registry: ${config.slug} !== ${entry.slug}`);
  }
  if (config.data.projectRef !== entry.projectRef) {
    throw new Error(
      `Demo config project ref does not match registry: ${config.data.projectRef ?? "(missing)"}`,
    );
  }

  const expiry = Date.parse(entry.expiresAt);
  if (!Number.isFinite(expiry)) throw new Error(`Invalid demo expiry: ${entry.expiresAt}`);
  if (expiry <= now.getTime()) throw new Error(`Demo registry entry expired: ${slug}`);
  if ((production || process.env.VERCEL_ENV !== undefined) && isPlaceholderProjectRef(entry.projectRef)) {
    throw new Error(`Placeholder demo project ref is forbidden in a Vercel deployment: ${slug}`);
  }

  return config;
}

export function logDemoSideEffect(
  effect: string,
  safeIds: Readonly<Record<string, string | number>> = {},
): void {
  const ids = Object.fromEntries(
    Object.entries(safeIds).filter(([key]) => /(?:Id|Ids)$/.test(key)),
  );
  console.info("[BananaFORCE demo stub]", { effect, ids });
}
