import type { CSSProperties } from "react";
import type { ClientBrand } from "@waltersignal/bananaforce-core";

/** Client brand accent mapped onto a neutral zinc shell (Linear / Stripe idiom). */
export function brandThemeVars(brand: ClientBrand): CSSProperties {
  const primary = brand.colors?.primary ?? "#b45309";

  return {
    "--accent": primary,
    "--accent-hover": `color-mix(in srgb, ${primary} 88%, black)`,
    "--accent-muted": `color-mix(in srgb, ${primary} 12%, white)`,
    "--accent-subtle": `color-mix(in srgb, ${primary} 8%, #fafafa)`,
    "--accent-ring": `color-mix(in srgb, ${primary} 24%, transparent)`,
  } as CSSProperties;
}
