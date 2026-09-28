import type { ClientConfig } from "@waltersignal/bananaforce-core";
import { EventRequestForm, WholesaleInquiryForm } from "./inquiry-forms";

export interface EventsPageOptions {
  /** Vertical-specific event categories. Defaults to a generic set. */
  eventTypes?: string[];
  /** Headline for the request form. Defaults to a vertical-neutral string. */
  title?: string;
  /** Sub-headline. Defaults to a vertical-neutral string. */
  lede?: string;
}

export function createEventsPage(
  clientConfig: ClientConfig,
  options: EventsPageOptions = {},
) {
  return function EventsPage() {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">{clientConfig.brand.name}</span>
            <h1>{options.title ?? "Request an event"}</h1>
            <p className="lede">
              {options.lede ?? "Tell us about your event and we will follow up with options."}
            </p>
          </header>
          <div className="panel pad">
            <EventRequestForm eventTypes={options.eventTypes} />
          </div>
        </section>
      </div>
    );
  };
}

export function createWholesalePage(clientConfig: ClientConfig) {
  return function WholesalePage() {
    return (
      <div className="page">
        <section className="container" style={{ maxWidth: 720 }}>
          <header className="page-head">
            <span className="eyebrow">{clientConfig.brand.name}</span>
            <h1>Wholesale inquiry</h1>
            <p className="lede">Apply for wholesale pricing and account approval.</p>
          </header>
          <div className="panel pad">
            <WholesaleInquiryForm />
          </div>
        </section>
      </div>
    );
  };
}
