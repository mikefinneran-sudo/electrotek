# ElectroTek Consultants

WalterSignal client — forensic engineering firm (James V. Miller, Jim Finneran).

**Live:** https://electrotekconsultants.com
**Stack:** Static HTML (Tailwind CDN)
**Contact API:** `https://waltersignal.io/api/electrotek-contact` (hosted on waltersignal-next until moved)

**Vault:** `~/Documents/ObsidianVault/[1] WalterSignal/Clients/Electotek Consultants/`

## Canonical copy

**This repo is the only source of truth.** The `waltersignal-next/public/clients/electrotek`
mirror was deleted at the cutover; `/clients/electrotek*` on waltersignal.io now 301s here.
Do not recreate it — the two copies drifted apart once already.

## DNS

Registrar and DNS are both **DreamHost**. Nameservers stay on `ns1-3.dreamhost.com` — do
**not** point them at Vercel. Google Workspace mail for this domain is served from that same
zone (7 MX records plus an SPF TXT), and moving nameservers without recreating them breaks
the client's email.

The site is attached to Vercel by two A records in the DreamHost zone:

| Type | Name | Value |
|---|---|---|
| A | *(apex)* | `76.76.21.21` |
| A | `www` | `76.76.21.21` |

`www` is set to 308 to the apex in the Vercel project's domain settings.

## URLs

`vercel.json` sets `cleanUrls`, so pages are served extensionless (`/about`, not
`/about.html`) and internal links are written that way. A `.html` URL still resolves — it
308s to the clean form.

## Adding a hostname

Any new hostname serving this site must be added to `ALLOWED_ORIGINS` in
`waltersignal-next/src/app/api/electrotek-contact/route.ts`, or the browser blocks the
contact form response. The CORS preflight falls back to `waltersignal.io` for unknown
origins, so the failure looks like a silently broken form rather than an error.

## Known gaps

- `miller.html` renders a `JVM` monogram. It needs a real photograph of James V. Miller
  saved as `miller-headshot.webp`; the slot is marked with a `PORTRAIT SLOT` comment.
- No `canonical` or `og:url` tags on any page.

## Local dev

```bash
cd ~/Code/electrotek
python3 -m http.server 8080
```

Note that clean URLs are a Vercel behaviour, so `python3 -m http.server` still needs the
`.html` paths. Use `vercel dev` to exercise routing as it runs in production.

## Deploy

Pushing `main` deploys production automatically (Vercel project `waltersignal/electrotek`, GitHub-connected).
