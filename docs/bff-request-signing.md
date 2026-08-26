# BFF Request Signing

The Market Site browser only calls the same-origin Next.js BFF under `/api`.
The BFF signs every request it forwards to FastAPI using the server-only
`BFF_REQUEST_SIGNING_SECRET`; the browser never receives that secret.

The BFF sends:

```text
X-API-Key: market-bff-v1
X-Timestamp: <unix-seconds>
X-Signature: v1=<hmac-sha256-hex>
```

The HMAC input is four LF-separated lines: uppercase HTTP method, raw
path-with-query, timestamp, and the SHA-256 hex digest of the raw request
body. FastAPI rejects missing, stale, or tampered signatures before route
authentication. Excluded because they have their own credentials:

- `/health`
- provider/payment webhooks
- `/gw/{gateway_key}/...` — buyers call this from their own scripts with the
  platform-minted gateway key; it never goes through the website BFF

Set the same secret in the backend and frontend server environments. Never
put it in a `NEXT_PUBLIC_*` variable or a browser-accessible config file.
