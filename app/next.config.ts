import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  transpilePackages: [
    "@waltersignal/bananaforce-core",
    "@waltersignal/bananaforce-data-supabase",
    "@waltersignal/bananaforce-module-admin",
    "@waltersignal/bananaforce-module-crew-portal",
    "@waltersignal/bananaforce-module-crm",
    "@waltersignal/bananaforce-module-expense",
    "@waltersignal/bananaforce-modules",
  ],
};

export default nextConfig;
