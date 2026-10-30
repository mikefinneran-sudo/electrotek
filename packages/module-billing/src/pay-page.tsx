import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { PayView } from "./pay-ui";

interface PaySearchParams {
  token?: string;
  id?: string;
}

/** Factory for the client /pay page (token-gated invoice payment). */
export function createPayPage(clientConfig: ClientConfig) {
  return async function PayPage({
    searchParams,
  }: {
    searchParams: Promise<PaySearchParams>;
  }) {
    const params = await searchParams;
    const token = params.token ?? "";
    const invoiceId = params.id ?? "";
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

    if (!token || !invoiceId) {
      return (
        <div className="page">
          <section className="container" style={{ maxWidth: 720 }}>
            <header className="page-head">
              <span className="eyebrow">{clientConfig.brand.name}</span>
              <h1>Payment Link Required</h1>
            </header>
            <div className="callout">Use the payment link from your email.</div>
          </section>
        </div>
      );
    }

    return (
      <PayView
        token={token}
        invoiceId={invoiceId}
        brandName={clientConfig.brand.name}
        publishableKey={publishableKey}
      />
    );
  };
}
