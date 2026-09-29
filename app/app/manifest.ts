import type { MetadataRoute } from "next";
import clientConfig from "../client.config";

// PWA manifest, driven by the client's brand. Next auto-serves this at
// /manifest.webmanifest and links it. Icons reference public/; swap in real
// brand icons per client (see TODO).
export default function manifest(): MetadataRoute.Manifest {
  const brand = clientConfig.brand;
  // Fallbacks match the shell tokens in globals.css, not the retired demo theme.
  const themeColor = brand.colors?.primary ?? "#B87333";
  const background = brand.colors?.primaryDark ?? "#0C1118";

  return {
    name: brand.name,
    short_name: brand.name,
    description: `Staff workspace for ${brand.name}.`,
    start_url: "/",
    display: "standalone",
    background_color: background,
    theme_color: themeColor,
    icons: [
      // TODO: replace with per-client brand icons in public/.
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
