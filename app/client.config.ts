import type { ClientConfig } from "@waltersignal/bananaforce-core";

const config: ClientConfig = {
  slug: "electrotek",
  domain: "app.electrotekconsultants.com",
  brand: {
    name: "ElectroTek Consultants",
    colors: { primary: "#B87333", primaryDark: "#0C1118" },
  },
  data: {
    adapter: "supabase",
    projectRef: "oghdtqxkiddpqoagmwhr",
  },
  auth: {
    // crm and expense are both staff-audience modules; there is no customer surface yet.
    staff: {
      provider: "supabase",
      staffHome: "/cases",
      // Redundant with the Internal consent screen, which already restricts
      // sign-in to this Workspace org. Kept as a second layer so the restriction
      // survives the client being recreated as External.
      googleWorkspaceDomain: "electrotekconsultants.com",
    },
  },
  modules: [
    "crm",
    "expense",
    "forensic-case",
  ],
};

export default config;
