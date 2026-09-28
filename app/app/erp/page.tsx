import clientConfig from "../../client.config";
import { createRegistry } from "@waltersignal/bananaforce-core";
import { ALL_MODULES, MODULE_BY_ID } from "@waltersignal/bananaforce-modules";
import { ModuleGroupPanel, ModuleRow } from "../../components/module-surface";
import { featureForModule, MODULE_GROUPS } from "../../lib/module-features";
import { ensureStaffOrDemo } from "../../lib/staff-page";

export const dynamic = "force-dynamic";

const registry = createRegistry([...ALL_MODULES]);
const enabledModules = registry.resolve(clientConfig);
const enabledIds = new Set(enabledModules.map((m) => m.id));

export default async function ErpIndexPage() {
  await ensureStaffOrDemo();
  return (
    <main className="dashboard">
      <div className="dashboard-inner">
        <header className="dashboard-head">
          <div>
            <p className="dashboard-kicker">Module directory</p>
            <h1>All surfaces</h1>
            <p className="dashboard-lede">
              Every module in the catalog. Locked modules are not part of this deploy.
            </p>
          </div>
        </header>

        <div className="dashboard-groups">
          {MODULE_GROUPS.map((group) => {
            const rows = group.moduleIds
              .map((id) => MODULE_BY_ID[id])
              .filter((m): m is NonNullable<typeof m> => !!m)
              .map((module) => {
                const feature = featureForModule(module.id, module);
                const navigable = enabledIds.has(module.id) && !!feature.href;
                return { module, feature, navigable };
              });

            if (rows.length === 0) return null;

            return (
              <ModuleGroupPanel
                key={group.id}
                label={group.label}
                description={group.description}
              >
                {rows.map(({ module, feature, navigable }) => (
                  <ModuleRow
                    key={module.id}
                    feature={feature}
                    href={navigable ? feature.href : undefined}
                    locked={!navigable}
                  />
                ))}
              </ModuleGroupPanel>
            );
          })}
        </div>
      </div>
    </main>
  );
}
