# bakulcilor.timeline.eu.org — Nautica fork

Cloudflare Worker proxy tunnel. Fork dari [FoolVPN-ID/Nautica](https://github.com/FoolVPN-ID/Nautica), di-refactor:

- API key & creds — **tidak ada hardcode** (versi lama bocor lewat file)
- Proxy & KV list — **self-hosted** di repo ini
- Health check — **TCP langsung** (`cloudflare:sockets`), tanpa API eksternal
- `SUB_PAGE_URL` — domain sendiri

## Deploy

1. Copy `_worker.js` → worker Cloudflare
2. (Opsional) env: `REVERSE_PRX_TARGET`
3. Deploy

## Env vars

- `REVERSE_PRX_TARGET` (default `example.com`) — reverse proxy target