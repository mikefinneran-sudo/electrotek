import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { isContractEsignConfigured } from "./server";
import { ContractView, SignView } from "./ui";

interface SignSearchParams {
  token?: string;
}

/**
 * Factory for the /sign client page (the page-factory pattern — see
 * module-quote-engine/src/page.tsx). The client opens /sign?token=<jwt> from the
 * link minted by staff; the SignView fetches + executes the sign via the
 * token-gated /api/sign route. No staff auth — the token is the gate.
 */
export function createSignPage(clientConfig: ClientConfig) {
  return async function SignPage({
    searchParams,
  }: {
    searchParams: Promise<SignSearchParams>;
  }) {
    const params = await searchParams;
    const token = params.token ?? "";

    if (!token) {
      return (
        <div className="page">
          <section className="container" style={{ maxWidth: 720 }}>
            <header className="page-head">
              <span className="eyebrow">{clientConfig.brand.name}</span>
              <h1>Signing link required</h1>
            </header>
            <div className="callout">
              This page needs a valid signing link. Please use the link sent to you.
            </div>
          </section>
        </div>
      );
    }

    return <SignView token={token} brandName={clientConfig.brand.name} />;
  };
}

/**
 * Factory for the staff /contract page. Auth is enforced server-side by the
 * /api/contract route's deny-by-default authorize callback; this page renders the
 * staff view that calls it.
 */
export function createContractPage(clientConfig: ClientConfig) {
  return function ContractPage() {
    return (
      <ContractView
        title={`${clientConfig.brand.name} contracts`}
        setupRequired={!isContractEsignConfigured()}
      />
    );
  };
}
