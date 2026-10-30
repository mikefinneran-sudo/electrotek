const MERCURY_API_BASE = "https://api.mercury.com/api/v1";
const MERCURY_TIME_ZONE = "America/Indiana/Indianapolis";

export type MercuryInvoiceStatus = "Unpaid" | "Processing" | "Paid" | "Cancelled";

export interface MercuryClientConfig {
  apiToken: string;
  accountId?: string;
  ccEmails?: readonly string[];
  cardEnabled?: boolean;
}

export interface MercuryCustomerAddress {
  name: string;
  address1: string;
  address2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface MercuryCustomer {
  id: string;
  name: string;
  email: string;
  deletedAt?: string | null;
}

export interface MercuryLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface MercuryInvoice {
  id: string;
  invoiceNumber: string;
  slug: string;
  status: MercuryInvoiceStatus;
  amount: number;
  updatedAt?: string;
}

export interface MercuryError {
  code: "not_configured" | "invalid_input" | "request_failed" | "invalid_response";
  message: string;
  status?: number;
}

export type MercuryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MercuryError };

function failure(
  code: MercuryError["code"],
  message: string,
  status?: number,
): MercuryResult<never> {
  return {
    ok: false,
    error: { code, message, ...(status === undefined ? {} : { status }) },
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nextPage(value: unknown): string | null {
  return stringValue(objectValue(value)?.nextPage);
}

function customerFromValue(value: unknown): MercuryCustomer | null {
  const row = objectValue(value);
  const id = stringValue(row?.id);
  const name = stringValue(row?.name);
  const email = stringValue(row?.email);
  if (!id || !name || !email) return null;
  return {
    id,
    name,
    email,
    deletedAt: stringValue(row?.deletedAt),
  };
}

const MERCURY_INVOICE_STATUSES: readonly MercuryInvoiceStatus[] = [
  "Unpaid",
  "Processing",
  "Paid",
  "Cancelled",
];

function invoiceFromValue(value: unknown): MercuryInvoice | null {
  const row = objectValue(value);
  const id = stringValue(row?.id);
  const invoiceNumber = stringValue(row?.invoiceNumber);
  const slug = stringValue(row?.slug);
  const amount = numberValue(row?.amount);
  const status = stringValue(row?.status) as MercuryInvoiceStatus | null;
  if (
    !id ||
    !invoiceNumber ||
    !slug ||
    amount == null ||
    !status ||
    !MERCURY_INVOICE_STATUSES.includes(status)
  ) {
    return null;
  }
  return {
    id,
    invoiceNumber,
    slug,
    status,
    amount,
    updatedAt: stringValue(row?.updatedAt) ?? undefined,
  };
}

async function mercuryRequest<T>(
  config: MercuryClientConfig,
  path: string,
  init: RequestInit = {},
): Promise<MercuryResult<T>> {
  const token = config.apiToken.trim();
  if (!token) return failure("not_configured", "Mercury is not configured.");

  try {
    const response = await fetch(`${MERCURY_API_BASE}${path}`, {
      signal: AbortSignal.timeout(30_000),
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) {
          return failure("invalid_response", "Mercury returned an invalid response.");
        }
      }
    }
    if (!response.ok) {
      return failure(
        "request_failed",
        `Mercury request failed with status ${response.status}.`,
        response.status,
      );
    }
    return { ok: true, data: data as T };
  } catch {
    return failure("request_failed", "Mercury request failed.");
  }
}

export async function findOrCreateMercuryCustomer(
  config: MercuryClientConfig,
  input: {
    name: string;
    email: string;
    address?: MercuryCustomerAddress;
  },
): Promise<MercuryResult<MercuryCustomer>> {
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name || !email) {
    return failure("invalid_input", "A customer name and email are required.");
  }

  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const search = new URLSearchParams({ limit: "1000", order: "asc" });
    if (cursor) search.set("start_after", cursor);
    const result = await mercuryRequest<Record<string, unknown>>(
      config,
      `/ar/customers?${search.toString()}`,
    );
    if (!result.ok) return result;
    const rows = Array.isArray(result.data.customers) ? result.data.customers : [];
    const match = rows
      .map(customerFromValue)
      .find(
        (customer): customer is MercuryCustomer =>
          customer !== null &&
          !customer.deletedAt &&
          customer.email.toLowerCase() === email.toLowerCase(),
      );
    if (match) return { ok: true, data: match };

    const following = nextPage(result.data.page);
    if (!following || seen.has(following)) break;
    seen.add(following);
    cursor = following;
  } while (cursor);

  let body: string;
  try {
    body = JSON.stringify({
      name,
      email,
      ...(input.address ? { address: input.address } : {}),
    });
  } catch {
    return failure("invalid_input", "The customer address is invalid.");
  }
  const created = await mercuryRequest<unknown>(config, "/ar/customers", {
    method: "POST",
    body,
  });
  if (!created.ok) return created;
  const customer = customerFromValue(created.data);
  return customer
    ? { ok: true, data: customer }
    : failure("invalid_response", "Mercury returned an invalid customer.");
}

function dateInMercuryTimeZone(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MERCURY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const result = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1));
  result.setUTCDate(result.getUTCDate() + Math.max(0, Math.floor(days)));
  return result.toISOString().slice(0, 10);
}

function ccEmails(config: MercuryClientConfig): string[] {
  return [
    ...new Set((config.ccEmails ?? []).map((email) => email.trim()).filter(Boolean)),
  ];
}

export async function resolveMercuryDestinationAccount(
  config: MercuryClientConfig,
): Promise<MercuryResult<string>> {
  const configured = config.accountId?.trim();
  if (configured) return { ok: true, data: configured };

  const result = await mercuryRequest<unknown>(config, "/accounts");
  if (!result.ok) return result;
  const object = objectValue(result.data);
  const rows = Array.isArray(result.data)
    ? result.data
    : Array.isArray(object?.accounts)
      ? object.accounts
      : [];
  for (const value of rows) {
    const account = objectValue(value);
    const id = stringValue(account?.id);
    const kind = stringValue(account?.kind)?.toLowerCase();
    const type = stringValue(account?.type)?.toLowerCase();
    const status = stringValue(account?.status)?.toLowerCase();
    if (id && status === "active" && (kind === "checking" || type === "checking")) {
      return { ok: true, data: id };
    }
  }
  return failure("invalid_response", "Mercury has no active checking account.");
}

async function findMercuryInvoiceByNumber(
  config: MercuryClientConfig,
  invoiceNumber: string,
): Promise<MercuryResult<MercuryInvoice | null>> {
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const search = new URLSearchParams({ limit: "1000", order: "asc" });
    if (cursor) search.set("start_after", cursor);
    const result = await mercuryRequest<Record<string, unknown>>(
      config,
      `/ar/invoices?${search.toString()}`,
    );
    if (!result.ok) return result;
    const rows = Array.isArray(result.data.invoices) ? result.data.invoices : [];
    const match = rows
      .map(invoiceFromValue)
      .find((invoice): invoice is MercuryInvoice => invoice?.invoiceNumber === invoiceNumber);
    if (match) return { ok: true, data: match };

    const following = nextPage(result.data.page);
    if (!following || seen.has(following)) break;
    seen.add(following);
    cursor = following;
  } while (cursor);
  return { ok: true, data: null };
}

export async function createMercuryInvoice(
  config: MercuryClientConfig,
  input: {
    customerId: string;
    invoiceNumber: string;
    lineItems: readonly MercuryLineItem[];
    dueInDays?: number;
    payerMemo?: string;
  },
): Promise<MercuryResult<MercuryInvoice>> {
  const lineItems = input.lineItems.map((item) => ({
    name: item.name.trim(),
    quantity: item.quantity,
    unitPrice: Math.round(item.unitPrice * 100) / 100,
  }));
  if (
    !input.customerId.trim() ||
    !input.invoiceNumber.trim() ||
    lineItems.length === 0 ||
    lineItems.some(
      (item) =>
        !item.name ||
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice <= 0,
    )
  ) {
    return failure("invalid_input", "Valid invoice details are required.");
  }

  // Look the number up first: a pass that created the invoice but lost the result
  // must not email the client a second invoice on the next pass.
  const prior = await findMercuryInvoiceByNumber(config, input.invoiceNumber.trim());
  if (!prior.ok) return prior;
  if (prior.data) return { ok: true, data: prior.data };

  const account = await resolveMercuryDestinationAccount(config);
  if (!account.ok) return account;
  const invoiceDate = dateInMercuryTimeZone(new Date());
  const dueInDays = Number.isFinite(input.dueInDays) ? input.dueInDays ?? 15 : 15;
  const dueDate = addDays(invoiceDate, dueInDays);
  const created = await mercuryRequest<unknown>(config, "/ar/invoices", {
    method: "POST",
    body: JSON.stringify({
      invoiceDate,
      dueDate,
      customerId: input.customerId.trim(),
      invoiceNumber: input.invoiceNumber.trim(),
      ccEmails: ccEmails(config),
      destinationAccountId: account.data,
      creditCardEnabled: config.cardEnabled !== false,
      achDebitEnabled: true,
      useRealAccountNumber: false,
      lineItems,
      ...(input.payerMemo ? { payerMemo: input.payerMemo } : {}),
      sendEmailOption: "SendNow",
    }),
  });
  if (created.ok) {
    const invoice = invoiceFromValue(created.data);
    if (invoice) return { ok: true, data: invoice };
    const recovered = await findMercuryInvoiceByNumber(
      config,
      input.invoiceNumber.trim(),
    );
    if (recovered.ok && recovered.data) return { ok: true, data: recovered.data };
    return failure("invalid_response", "Mercury returned an invalid invoice.");
  }

  // A retry after Mercury accepted the POST but the response was lost must
  // converge on the already-created invoice instead of sending a second one.
  const existing = await findMercuryInvoiceByNumber(
    config,
    input.invoiceNumber.trim(),
  );
  if (existing.ok && existing.data) return { ok: true, data: existing.data };
  return created;
}

export async function getMercuryInvoice(
  config: MercuryClientConfig,
  id: string,
): Promise<MercuryResult<MercuryInvoice>> {
  if (!id.trim()) return failure("invalid_input", "An invoice id is required.");
  const result = await mercuryRequest<unknown>(
    config,
    `/ar/invoices/${encodeURIComponent(id.trim())}`,
  );
  if (!result.ok) return result;
  const invoice = invoiceFromValue(result.data);
  return invoice
    ? { ok: true, data: invoice }
    : failure("invalid_response", "Mercury returned an invalid invoice.");
}
