/** Client-facing pay page (not the JSON API URL). */
export function payPageUrl(origin: string, token: string, invoiceId: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/pay?token=${encodeURIComponent(token)}&id=${encodeURIComponent(invoiceId)}`;
}
