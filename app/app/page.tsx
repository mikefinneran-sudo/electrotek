import Link from "next/link";
import clientConfig from "../client.config";
import { ModuleGroupPanel, ModuleRow } from "../components/module-surface";
import { createRegistry } from "@waltersignal/bananaforce-core";
import { ALL_MODULES } from "@waltersignal/bananaforce-modules";
import { featureForModule } from "../lib/module-features";

/**
 * Client staff landing.
 *
 * This page previously rendered BananaFORCE's own marketing, inherited wholesale
 * from apps/_template: "WE HATE SAAS TOO.", a roast of per-seat pricing, a
 * "FRENCHIE ON THE BANANA PHONE" blockquote, and buttons linking to /inventory
 * and /contact — neither of which exists in this app. A client's staff should
 * not sign in to the vendor pitching them software they have already bought,
 * and certainly not into dead links.
 *
 * It is now driven entirely by client.config.ts: the client's own name, and the
 * staff modules that client actually enabled. There is no hand-written copy, so
 * it cannot drift out of step with what they are entitled to.
 */
const registry = createRegistry([...ALL_MODULES]);
const enabledModules = registry.resolve(clientConfig);

/** Staff-audience modules only, in the order client.config.ts lists them. */
const staffModules = enabledModules.filter((mod) => mod.audience === "staff");

export default function Home() {
  return (
    <main className="page">
      <div className="container">
        <header className="page-head">
          <p className="eyebrow">Staff workspace</p>
          <h1>{clientConfig.brand.name}</h1>
        </header>

        <ModuleGroupPanel
          label="Modules"
          description={`Enabled for ${clientConfig.brand.name}.`}
        >
          {staffModules.map((mod) => {
            const feature = featureForModule(mod.id, mod);
            // Every module declares its page route first and its API routes
            // after; the page is the only one worth linking a person to.
            const href = mod.routes?.find((route) => !route.startsWith("/api"));
            return <ModuleRow key={mod.id} feature={feature} href={href} />;
          })}
        </ModuleGroupPanel>

        <p className="page-foot-link">
          <Link href="/erp">View the full module directory</Link>
        </p>
      </div>
    </main>
  );
}
