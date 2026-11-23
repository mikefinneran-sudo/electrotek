import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Ported from bananaforce's vitest.config.mts (WAL-706 snapshot). The
// `server-only` marker package throws unless the bundler sets React's
// `react-server` export condition, which only Next's RSC compiler does.
// Under plain Vitest that condition is never set, so any module doing
// `import "server-only"` (packages/data-supabase/src/{server,service,staff}.ts)
// throws immediately. Aliasing the bare specifier straight to the package's
// own `empty.js` (what the `react-server` condition would have selected)
// sidesteps that without touching any other package's resolution.
const serverOnlyRequire = createRequire(resolve(process.cwd(), "packages/data-supabase/package.json"));
const serverOnlyEmpty = join(dirname(serverOnlyRequire.resolve("server-only")), "empty.js");

export default defineConfig({
  resolve: {
    alias: {
      "server-only": serverOnlyEmpty,
    },
  },
  test: {
    // Convention carried over from bananaforce: `*.spec.ts` is a real Vitest
    // suite; `*.test.ts` is a legacy `node:assert` script invoked directly
    // via `tsx` from that package's own `test` script.
    include: ["**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
  },
});
