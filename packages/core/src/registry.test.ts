import type { ClientConfig, ClientModule } from "./types";
import { createRegistry, registerModule, validateClientConfig } from "./registry";

// core stays runtime-agnostic (no node/DOM lib); declare the one global the
// test runner (tsx) provides so this file typechecks without @types/node.
declare const console: { log: (...args: unknown[]) => void };

let passed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}: ${message}`);
  }
}

function createConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    slug: "example-retail",
    domain: "example-retail.com",
    brand: { name: "Example Retail Co." },
    data: { adapter: "supabase" },
    modules: ["catalog"],
    ...overrides,
  };
}

const catalogModule: ClientModule = {
  id: "catalog",
  name: "Catalog",
  description: "Product catalog.",
  audience: "customer",
  dataAdapters: ["supabase"],
};

const quoteModule: ClientModule = {
  id: "quote-engine",
  name: "Quote Engine",
  description: "Quote intake.",
  audience: "mixed",
  dataAdapters: ["airtable"],
};

const orderingModule: ClientModule = {
  id: "ordering",
  name: "Ordering",
  description: "Cart and submit.",
  audience: "mixed",
  dataAdapters: ["supabase"],
  requires: ["catalog"],
};

test("createRegistry keeps registries independent", () => {
  const catalogRegistry = createRegistry([catalogModule]);
  const quoteRegistry = createRegistry([quoteModule]);

  assert(catalogRegistry.get("catalog") === catalogModule, "catalog registry should include catalog");
  assert(catalogRegistry.get("quote-engine") === undefined, "catalog registry should not include quote-engine");
  assert(quoteRegistry.get("quote-engine") === quoteModule, "quote registry should include quote-engine");
  assert(quoteRegistry.get("catalog") === undefined, "quote registry should not include catalog");
});

test("validateClientConfig rejects unknown module ids", () => {
  const errors = validateClientConfig(createConfig({ modules: ["missing-module"] }), [
    catalogModule,
  ]);

  assert(
    errors.includes("unknown module id: missing-module"),
    "unknown module id should be reported",
  );
});

test("validateClientConfig rejects adapter/module mismatches", () => {
  const errors = validateClientConfig(
    createConfig({ data: { adapter: "airtable" } }),
    [catalogModule],
  );

  assert(
    errors.includes('module "catalog" does not support data adapter "airtable"'),
    "adapter mismatch should be reported",
  );
});

test("validateClientConfig enforces module dependencies", () => {
  const errors = validateClientConfig(
    createConfig({ data: { adapter: "supabase", projectRef: "ref" }, modules: ["ordering"] }),
    [catalogModule, orderingModule],
  );

  assert(
    errors.includes('module "ordering" requires "catalog", which is not enabled'),
    "missing dependency should be reported",
  );

  const ok = validateClientConfig(
    createConfig({
      data: { adapter: "supabase", projectRef: "ref" },
      modules: ["catalog", "ordering"],
    }),
    [catalogModule, orderingModule],
  );
  assert(ok.length === 0, `satisfied dependency should pass, got: ${ok.join(", ")}`);
});

test("validateClientConfig requires projectRef for supabase", () => {
  const errors = validateClientConfig(
    createConfig({ data: { adapter: "supabase" } }),
    [catalogModule],
  );
  assert(
    errors.includes('data.projectRef is required when adapter is "supabase"'),
    "missing projectRef should be reported",
  );
});

test("validateClientConfig rejects bad slugs and duplicate modules", () => {
  const errors = validateClientConfig(
    createConfig({
      slug: "Bad Slug",
      data: { adapter: "supabase", projectRef: "ref" },
      modules: ["catalog", "catalog"],
    }),
    [catalogModule],
  );
  assert(
    errors.some((error) => error.includes("must be lowercase alphanumeric")),
    "bad slug should be reported",
  );
  assert(errors.includes("duplicate module id: catalog"), "duplicate module should be reported");
});

test("registerModule adds a module to the given registry", () => {
  const registry = createRegistry();
  assert(registry.get("catalog") === undefined, "registry should start empty");
  registerModule(catalogModule, registry);
  assert(registry.get("catalog") === catalogModule, "registerModule should add to the registry");
});

console.log(`✓ registry tests passed (${passed})`);
