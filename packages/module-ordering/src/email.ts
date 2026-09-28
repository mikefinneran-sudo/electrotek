import { Resend } from "resend";
import { formatPrice, tierLabel } from "@waltersignal/bananaforce-module-catalog/pricing";
import type { CustomerTier } from "@waltersignal/bananaforce-module-catalog";

export interface OrderEmailItem {
  name: string;
  itemNumber: number | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderEmailData {
  orderId: string;
  customerEmail: string | null;
  businessName: string | null;
  tier: CustomerTier;
  subtotal: number;
  items: OrderEmailItem[];
}

export interface OrderEmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface SendOrderNotificationResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build subject/html/text for the store order-notification email. Pure (no
 * transport) so the same content can be sent via Resend in production or
 * verified by tests. All customer- and product-supplied values are escaped.
 */
export function buildOrderNotificationEmail(order: OrderEmailData): OrderEmailContent {
  // Strip CR/LF so user-supplied values can't inject email headers via subject.
  const headerSafe = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
  const who = order.businessName || order.customerEmail || "Customer";
  const subjectWho = headerSafe(who);

  const rows = order.items
    .map(
      (item) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${item.qty}× ${escapeHtml(
          item.name,
        )} <span style="color:#999">#${item.itemNumber ?? "—"}</span></td>` +
        `<td align="right" style="padding:4px 8px;border-bottom:1px solid #eee">${formatPrice(
          item.lineTotal,
        )}</td></tr>`,
    )
    .join("");

  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:560px">
    <h2 style="margin:0 0 4px">New order — BananaFORCE</h2>
    <p style="margin:0 0 16px;color:#555">
      <strong>${escapeHtml(who)}</strong>${
        order.customerEmail ? ` &lt;${escapeHtml(order.customerEmail)}&gt;` : ""
      }<br>
      Account type: ${escapeHtml(tierLabel(order.tier))}<br>
      Order ID: <code>${escapeHtml(order.orderId)}</code>
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
    <p style="text-align:right;font-size:16px;margin-top:12px">
      <strong>Subtotal: ${formatPrice(order.subtotal)}</strong>
    </p>
    <p style="color:#999;font-size:12px">
      No online payment was taken — settle in store. Reply to this email to reach the customer.
    </p>
  </div>`;

  const text =
    `New order — BananaFORCE\n\n` +
    `${who}${order.customerEmail ? ` <${order.customerEmail}>` : ""}\n` +
    `Account type: ${tierLabel(order.tier)}\n` +
    `Order ID: ${order.orderId}\n\n` +
    order.items
      .map(
        (item) =>
          `  ${item.qty}× ${item.name} (#${item.itemNumber ?? "—"}) — ${formatPrice(
            item.lineTotal,
          )}`,
      )
      .join("\n") +
    `\n\nSubtotal: ${formatPrice(order.subtotal)}\n` +
    `No online payment was taken — settle in store.`;

  return {
    subject: `New order — ${subjectWho} — ${formatPrice(order.subtotal)}`,
    html,
    text,
  };
}

/**
 * Email the store when a customer submits an order. No card is captured online,
 * so this notification is how an order reaches staff for offline settlement.
 * Returns a result object instead of throwing — a failed email must never block
 * the order submission.
 */
export async function sendOrderNotification(
  order: OrderEmailData,
): Promise<SendOrderNotificationResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: true, error: "RESEND_API_KEY not set" };
  }

  const to = process.env.ORDER_NOTIFY_TO ?? "outreach@waltersignal.io";
  const from = process.env.ORDER_NOTIFY_FROM ?? "BananaFORCE <onboarding@resend.dev>";

  const resend = new Resend(apiKey);
  const { subject, html, text } = buildOrderNotificationEmail(order);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
      replyTo: order.customerEmail ?? undefined,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, id: data?.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
