import "server-only";

import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { CrewDashboard } from "./ui";
import { getDashboard, isCrewPortalConfigured } from "./server";
import type { CrewDashboardData } from "./types";

const EMPTY_DASHBOARD: CrewDashboardData = {
  leadCounts: {},
  pipelineCounts: {},
  mrr: 0,
  pipelineValue: 0,
  activeClientCount: 0,
  newLeadCount: 0,
  recentLeads: [],
  recentInspections: [],
};

export interface CrewPageOptions {
  /**
   * Deny-by-default staff gate, mirroring createCrewRouteHandlers' `authorize`
   * contract. Called before any aggregated data is fetched. When absent or it
   * returns false, the page renders a not-authorized state instead of fetching
   * and showing service-role (RLS-bypassing) data. Wire the real check:
   * `() => isStaffRequest()` from
   * @waltersignal/bananaforce-module-crew-portal/auth.
   */
  authorize?: () => boolean | Promise<boolean>;
}

/**
 * Factory for the /crew page (the page-factory pattern — see
 * module-admin/src/page.tsx). Server-side it reads the dashboard aggregate
 * through the service-role server layer and hands it to the client dashboard as
 * initial props. The other tabs (Leads/Pipeline/Client) fetch on demand via the
 * gated /api/crew endpoint.
 *
 * IMPORTANT: this page renders staff-only data and the service-role client
 * bypasses RLS. Pass a deny-by-default `authorize` callback (the same staff
 * check the route uses). With no `authorize` wired, access is DENIED and the
 * page renders a not-authorized state — it never fetches or shows aggregated
 * data without an explicit allow. The consuming app should also place a staff
 * auth gate (middleware or layout) in front of the /crew route.
 */
export function createCrewPage(
  clientConfig: ClientConfig,
  options: CrewPageOptions = {},
) {
  return async function CrewPage() {
    const title = `${clientConfig.brand.name} crew portal`;

    // Deny-by-default: with no authorize callback wired by the app, access is
    // rejected. Crew portal is staff-only and served via the service-role client
    // (RLS is bypassed), so the page must gate before fetching anything.
    const allowed = options.authorize
      ? await Promise.resolve(options.authorize())
      : false;

    if (!allowed) {
      return <CrewDashboard title={title} notAuthorized dashboard={EMPTY_DASHBOARD} />;
    }

    if (!isCrewPortalConfigured()) {
      return <CrewDashboard title={title} setupRequired dashboard={EMPTY_DASHBOARD} />;
    }

    const dashboard = await getDashboard();
    return <CrewDashboard title={title} dashboard={dashboard} />;
  };
}
