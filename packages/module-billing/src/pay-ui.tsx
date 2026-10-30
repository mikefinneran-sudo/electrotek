"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ClientInvoice = {
  number: string;
  amount_due: number | null;
  currency: string;
  status: string;
  card_total: number | null;
  card_fee_passthrough: boolean;
};

declare global {
  interface Window {
    Stripe?: (key: string) => {
      elements: () => {
        create: (type: "card") => {
          mount: (el: HTMLElement) => void;
          unmount: () => void;
        };
      };
      confirmCardPayment: (
        clientSecret: string,
        data: { payment_method: { card: unknown } },
      ) => Promise<{ error?: { message?: string }; paymentIntent?: { status?: string } }>;
    };
  }
}

function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Stripe.js"));
    document.head.appendChild(script);
  });
}

export function PayView({
  token,
  invoiceId,
  brandName,
  publishableKey,
  endpoint = "/api/billing",
}: {
  token: string;
  invoiceId: string;
  brandName: string;
  publishableKey: string;
  endpoint?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const cardElementRef = useRef<{ unmount: () => void } | null>(null);
  const [invoice, setInvoice] = useState<ClientInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  const apiBase = `${endpoint}?token=${encodeURIComponent(token)}&id=${encodeURIComponent(invoiceId)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiBase, { headers: { Accept: "application/json" } });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          invoice?: ClientInvoice;
          error?: string;
        };
        if (!res.ok || !data.ok || !data.invoice) {
          if (!cancelled) setError(data.error ?? "This payment link is invalid or has expired.");
          return;
        }
        if (!cancelled) {
          setInvoice(data.invoice);
          if (data.invoice.status === "paid") setPaid(true);
        }
      } catch {
        if (!cancelled) setError("Could not load this invoice.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!invoice || paid || !publishableKey) return;
    let mounted = true;
    (async () => {
      try {
        await loadStripeJs();
        if (!mounted || !cardRef.current || !window.Stripe) return;
        const stripe = window.Stripe(publishableKey);
        const elements = stripe.elements();
        const card = elements.create("card");
        card.mount(cardRef.current);
        cardElementRef.current = card;
      } catch {
        if (mounted) setError("Card payments are not available right now.");
      }
    })();
    return () => {
      mounted = false;
      cardElementRef.current?.unmount?.();
      cardElementRef.current = null;
    };
  }, [invoice, paid, publishableKey]);

  const pay = useCallback(async () => {
    setError(null);
    if (!publishableKey) {
      setError("Card payments are not configured.");
      return;
    }
    const card = cardElementRef.current;
    if (!card) return;
    setPaying(true);
    try {
      await loadStripeJs();
      const stripe = window.Stripe?.(publishableKey);
      if (!stripe) throw new Error("Stripe unavailable");
      const res = await fetch(`${apiBase}&action=payment-intent`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        clientSecret?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.clientSecret) {
        setError(data.error ?? "Could not start payment.");
        return;
      }
      const result = await stripe.confirmCardPayment(data.clientSecret, {
        payment_method: { card },
      });
      if (result.error) {
        setError(result.error.message ?? "Payment failed.");
        return;
      }
      if (result.paymentIntent?.status === "succeeded") setPaid(true);
    } catch {
      setError("Payment could not be completed.");
    } finally {
      setPaying(false);
    }
  }, [apiBase, publishableKey]);

  if (error && !invoice) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <div className="callout">{error}</div>
        </section>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <p className="lede">Loading invoice…</p>
        </section>
      </div>
    );
  }

  const money = (value: number | null) =>
    value != null
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: invoice.currency.toUpperCase(),
        }).format(value)
      : "—";
  const amount = money(invoice.amount_due);
  const cardAmount = money(invoice.card_total ?? invoice.amount_due);

  return (
    <div className="page">
      <section className="container" style={{ maxWidth: 520 }}>
        <header className="page-head">
          <span className="eyebrow">{brandName}</span>
          <h1>Pay Invoice</h1>
          <p className="lede">
            {invoice.number} — {amount}
          </p>
        </header>
        {paid ? (
          <div className="callout tint">
            <strong>Payment received.</strong> Thank you — you are all set.
          </div>
        ) : (
          <div className="panel pad form">
            {!publishableKey ? (
              <p className="form-msg">Card payment is not configured. Contact {brandName}.</p>
            ) : (
              <>
                {invoice.card_fee_passthrough ? (
                  <p className="form-msg">
                    Card total {cardAmount} includes the 2.9% + $0.30 card processing fee. To pay{" "}
                    {amount} with no fee by ACH or wire, use the bank details in your invoice email.
                  </p>
                ) : null}
                <div ref={cardRef} style={{ marginBottom: "1rem" }} />
                {error ? (
                  <p role="alert" className="form-msg error">
                    {error}
                  </p>
                ) : null}
                <button type="button" className="btn" disabled={paying} onClick={pay}>
                  {paying ? "Processing…" : `Pay ${cardAmount}`}
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
