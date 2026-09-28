import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

// This file lives at packages/eslint-config/index.mjs; every consumer
// (apps/* and, since WAL-592, packages/*) runs `eslint .` from its own
// directory, so a relative rootDir glob resolves against the consumer's
// cwd, not the repo root. Anchor it to this file's location instead so it
// resolves the same everywhere.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** @type {import("eslint").Linter.Config[]} */
const config = defineConfig([
  ...nextVitals,
  ...tseslint.configs.recommended,
  {
    settings: {
      // WAL-592: this config is shared by packages/* — plain TS/ESM libraries
      // and React component packages, not Next apps. Without these,
      // eslint-config-next's next/react-vitals bundle prints two cosmetic
      // warnings on every non-Next package: it scans for a `pages/` dir it
      // will never find, and it can't `detect` a React version because most
      // packages don't depend on `react` at all. Pointing it at the real
      // Next apps and pinning the version silences both without touching
      // which rules apply — the @next/next and react-hooks rules stay on
      // and keep catching real issues (e.g. no-assign-module-variable,
      // legitimate given every packages/* module ships through the apps'
      // `transpilePackages` webpack pipeline).
      next: { rootDir: [`${repoRoot}apps/*/`] },
      react: { version: "19.2.4" },
    },
    rules: {
      // Authorize stubs and route handlers often need the signature but not every arg.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Parked at "warn" by WAL-592, cleared and promoted to "error" by
      // WAL-593. Every module is now at zero, verified as a fixed point: the
      // count reached zero and a second run on an unchanged tree stayed at
      // zero. That second run is not ceremony — this rule reports at most one
      // offending statement per effect, so fixing the reported one can reveal
      // another that was masked. A single zero could be measuring a masked
      // state; only a stable zero means anything.
      //
      // Two deliberate suppressions remain, both one-time reads of a
      // client-only browser API on mount (a URL param, and localStorage), each
      // carrying an inline comment. React's own docs treat that use as
      // legitimate; forcing a reducer onto it would be over-engineering
      // correct code.
      "react-hooks/set-state-in-effect": "error",
    },
  },
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/.turbo/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
  ]),
]);

export default config;
