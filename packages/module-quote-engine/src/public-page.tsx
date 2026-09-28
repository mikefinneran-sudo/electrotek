import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { toPublicQuoteView } from "./lifecycle";
import { PublicQuote } from "./public-quote";
import {
  getAddons,
  getInspectionByToken,
  isQuoteEngineConfigured,
  listLineItems,
  recordQuoteViewed,
} from "./server";

/**
 * Re-export from the consuming app's `app/quote/[token]/page.tsx`.
 *
 * The token is in the URL, so this page MUST NOT be indexed and MUST NOT be
 * cached by an intermediary — a search engine that crawls a forwarded link
 * would publish a customer's pricing.
 */
export const publicQuoteMetadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

// NOTE: there is deliberately no `publicQuoteDynamic` constant to re-export.
// Next statically parses route segment config, so the app file must declare
// `export const dynamic = "force-dynamic";` as a literal — re-exporting a
// constant from here fails the build ("can't recognize the exported `dynamic`
// field in route"). It matters: the quote's status changes underneath the page
// (viewed, accepted, expired), so a cached render would show a customer a live
// Accept button on a quote they already answered.

interface PublicQuotePageProps {
  params: Promise<{ token: string }>;
}

/**
 * Factory for the customer-facing `/quote/[token]` page. Same page-factory
 * pattern as createIntakePage.
 *
 * Everything is resolved server-side through the service-role client after the
 * token matches; the browser never queries Supabase and anon holds no grant on
 * `inspections`.
 */
export function createPublicQuotePage(clientConfig: ClientConfig) {
  return async function PublicQuotePage({ params }: PublicQuotePageProps) {
    const { token } = await params;

    // An unconfigured deploy must not imply anything about the token either.
    if (!isQuoteEngineConfigured()) notFound();

    const inspection = await getInspectionByToken(token);
    if (!inspection) notFound();

    // A quote that has not been sent has no customer-facing existence. Identical
    // 404 to an unknown token — a draft is not the customer's to preview.
    if (inspection.status === "drafting" || inspection.status === "ready_to_send") notFound();

    await recordQuoteViewed(token);

    // Re-read so the rendered status reflects the view we just stamped, rather
    // than showing 'Sent' on the very page that marked it viewed.
    const current = (await getInspectionByToken(token)) ?? inspection;
    const [addons, lines] = await Promise.all([getAddons(current.id), listLineItems(current.id)]);

    return (
      <PublicQuote
        quote={toPublicQuoteView(current, addons, lines)}
        endpoint={`/api/quote/${encodeURIComponent(token)}`}
        pdfUrl={`/api/quote/${encodeURIComponent(token)}?pdf=1`}
        providerName={clientConfig.brand.name}
      />
    );
  };
}
