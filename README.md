# ElectroTek Consultants

WalterSignal client — forensic engineering firm (James V. Miller, Jim Finneran).

**Stack:** Static HTML (Tailwind CDN)  
**Contact API:** `https://waltersignal.io/api/electrotek-contact` (hosted on waltersignal-next until moved)

**Vault:** `~/Documents/ObsidianVault/[1] WalterSignal/Clients/Electotek Consultants/`

## Which copy is canonical

**This repo is the only source of truth. Edit here.**

Two copies of this site exist and they have drifted before:

| Location | Role |
|---|---|
| `~/Code/electrotek` (this repo) | Canonical. Deploys to https://electrotek-waltersignal.vercel.app via Vercel project `waltersignal/electrotek`. |
| `waltersignal-next/public/clients/electrotek` | Frozen legacy mirror behind the `/clients/electrotek` rewrites in `waltersignal-next/vercel.json`. Do not edit. |

The legacy path is still the client-facing URL because `electrotekconsultants.com` has no DNS
records yet. Once a real domain exists, do the cutover below and the mirror goes away.

## Cutover checklist (blocked on client domain)

1. Register / point `electrotekconsultants.com`, add it to the `electrotek` Vercel project.
2. Swap `https://electrotek-waltersignal.vercel.app` for the real domain in
   `waltersignal-next/src/app/api/electrotek-contact/route.ts` → `ALLOWED_ORIGINS`.
3. Replace the ten `/clients/electrotek*` rewrites in `waltersignal-next/vercel.json` with 301s
   to the new domain, then delete `waltersignal-next/public/clients/electrotek`.

## Known gaps

- `miller.html` renders a `JVM` monogram. It needs a real photograph of James V. Miller
  saved as `miller-headshot.webp`; the slot is marked with a `PORTRAIT SLOT` comment.

## Local dev

```bash
cd ~/Code/electrotek
python3 -m http.server 8080
```

## Deploy

Pushing `main` deploys production automatically (Vercel project `waltersignal/electrotek`, GitHub-connected).
