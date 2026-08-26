import { createHash, createHmac } from "node:crypto";

import { SERVER_API_BASE } from "./server-api.ts";

function requestBodyBytes(body: BodyInit | null | undefined): Uint8Array {
  if (body == null) return new Uint8Array();
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError("BFF signing only supports byte, text, and URL-encoded request bodies");
}

function canonicalRequest(method: string, target: URL, timestamp: string, body: Uint8Array): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return `${method.toUpperCase()}\n${target.pathname}${target.search}\n${timestamp}\n${bodyHash}`;
}

export function signedHeaders(method: string, target: URL, body: BodyInit | null | undefined, now = Date.now()): Headers {
  const keyId = process.env["BFF_REQUEST_SIGNING_KEY_ID"] ?? "market-bff-v1";
  const secret = process.env["BFF_REQUEST_SIGNING_SECRET"];
  if (!secret) throw new Error("BFF_REQUEST_SIGNING_SECRET is required on the frontend server");
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac("sha256", secret)
    .update(canonicalRequest(method, target, timestamp, requestBodyBytes(body)), "ascii")
    .digest("hex");
  return new Headers({ "X-API-Key": keyId, "X-Timestamp": timestamp, "X-Signature": `v1=${signature}` });
}

export async function signedBackendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(path, SERVER_API_BASE);
  const headers = new Headers(init.headers);
  for (const name of ["x-api-key", "x-timestamp", "x-signature"]) headers.delete(name);
  signedHeaders(init.method ?? "GET", target, init.body).forEach((value, name) => headers.set(name, value));
  return fetch(target, { ...init, headers });
}
