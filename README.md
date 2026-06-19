# ElectroTek Consultants

WalterSignal client — forensic engineering firm (James V. Miller, Jim Finneran).

**Stack:** Static HTML (Tailwind CDN)  
**Live (legacy path):** https://waltersignal.io/clients/electrotek/ — migrate to client-owned deploy  
**Contact API:** `https://waltersignal.io/api/electrotek-contact` (hosted on waltersignal-next until moved)

**Vault:** `~/Documents/ObsidianVault/[1] WalterSignal/Clients/Electotek Consultants/`

## Local dev

```bash
cd ~/Code/electrotek
python3 -m http.server 8080
```

## Deploy

Connect repo to Vercel (static). After cutover, remove `/clients/electrotek` rewrites from waltersignal-next.
