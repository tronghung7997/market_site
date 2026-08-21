"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sellerTierLabel } from "@/lib/seller-tier";
import type { SellerApiKey } from "@/lib/types";
import { Button, Card, Spinner, Tag } from "@/components/ui";
import { Check, Copy, Plug, Shield, Trash } from "@/components/Icons";

const MIN_TIER_FOR_API = "trusted";
const MIN_TIER_LABEL = sellerTierLabel(MIN_TIER_FOR_API);
const API_BASE_PLACEHOLDER = "https://api-market.taskforces.info";
const SIGNING_VERSION = "v1";
const TIMESTAMP_TOLERANCE_SECONDS = 300;

/** Fixed cross-language test vector (matches backend tests). Placeholder only. */
const TEST_VECTOR = {
  method: "POST",
  path: "/seller/orders/123/deliver?notify=true",
  timestamp: "1786089600",
  body: '{"data":"hello"}',
  bodyHash: "1a1bc6b5b117ed93a2fcc40281efc93d8ccbcc3e52b2dd00a3ca64d54ba7cd38",
  secret: "sk_live_test_secret_for_vector_only_xxxxxxxx",
  signature: "v1=06b14a1cd0b91706fe889779a3bfda635cf6fcabeb70376c28384a8252c6b7be",
};

function useApiOperations() {
  const t = useTranslations("seller");
  return [
    {
      method: "GET" as const,
      path: "/seller/orders",
      description: t("opListOrders"),
    },
    {
      method: "POST" as const,
      path: "/seller/orders/{order_id}/accept",
      description: t("opAcceptOrder"),
    },
    {
      method: "POST" as const,
      path: "/seller/orders/{order_id}/deliver",
      description: t("opDeliverOrder"),
    },
    {
      method: "POST" as const,
      path: "/seller/variants/{variant_id}/resources",
      description: t("opBulkInventory"),
    },
  ];
}

const PYTHON_EXAMPLE = `import hashlib, hmac, time, requests

API_BASE = "${API_BASE_PLACEHOLDER}"
API_KEY = "ak_live_YOUR_KEY_ID"       # public — X-API-Key
API_SECRET = "sk_live_YOUR_SECRET"    # private — never send in a header

def sign(method: str, path_with_query: str, body: bytes = b"") -> dict:
    ts = str(int(time.time()))
    body_hash = hashlib.sha256(body).hexdigest()
    canonical = f"{method.upper()}\\n{path_with_query}\\n{ts}\\n{body_hash}"
    sig = hmac.new(API_SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return {
        "X-API-Key": API_KEY,
        "X-Timestamp": ts,
        "X-Signature": f"v1={sig}",
    }

# GET (empty body → SHA-256 of empty bytes)
path = "/seller/orders"
headers = sign("GET", path)
r = requests.get(API_BASE + path, headers=headers)
print(r.status_code, r.json())

# POST — sign the *raw* body bytes you will send (do not re-serialize JSON)
body = b'{"data":"uid|password"}'
path = "/seller/orders/123/deliver"
headers = sign("POST", path, body)
headers["Content-Type"] = "application/json"
r = requests.post(API_BASE + path, data=body, headers=headers)
print(r.status_code, r.json())
`;

const NODE_EXAMPLE = `const crypto = require("crypto");
// or: import crypto from "node:crypto";

const API_BASE = "${API_BASE_PLACEHOLDER}";
const API_KEY = "ak_live_YOUR_KEY_ID";
const API_SECRET = "sk_live_YOUR_SECRET";

function sign(method, pathWithQuery, body = Buffer.alloc(0)) {
  const ts = String(Math.floor(Date.now() / 1000));
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = [method.toUpperCase(), pathWithQuery, ts, bodyHash].join("\\n");
  const sig = crypto.createHmac("sha256", API_SECRET).update(canonical).digest("hex");
  return {
    "X-API-Key": API_KEY,
    "X-Timestamp": ts,
    "X-Signature": \`v1=\${sig}\`,
  };
}

// GET
const path = "/seller/orders";
const headers = sign("GET", path);
fetch(API_BASE + path, { headers }).then((r) => r.json()).then(console.log);

// POST — hash the exact bytes you send
const body = Buffer.from(JSON.stringify({ data: "uid|password" }));
const deliverPath = "/seller/orders/123/deliver";
fetch(API_BASE + deliverPath, {
  method: "POST",
  headers: { ...sign("POST", deliverPath, body), "Content-Type": "application/json" },
  body,
}).then((r) => r.json()).then(console.log);
`;

const SHELL_EXAMPLE = `# Build signature with openssl (macOS/Linux)
# Canonical request = METHOD\\nPATH?QUERY\\nTIMESTAMP\\nSHA256_HEX(BODY)

API_BASE="${API_BASE_PLACEHOLDER}"
API_KEY="ak_live_YOUR_KEY_ID"
API_SECRET="sk_live_YOUR_SECRET"
TS=$(date +%s)
PATH_Q="/seller/orders"
BODY=""   # empty for GET
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 | awk '{print $2}')
CANONICAL=$(printf '%s\\n%s\\n%s\\n%s' "GET" "$PATH_Q" "$TS" "$BODY_HASH")
SIG=$(printf '%s' "$CANONICAL" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

curl "$API_BASE$PATH_Q" \\
  -H "X-API-Key: $API_KEY" \\
  -H "X-Timestamp: $TS" \\
  -H "X-Signature: v1=$SIG"
`;

function CodeBlock({ title, code }: { title: string; code: string }) {
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-semibold">{title}</h4>
        <Button size="sm" variant="ghost" onClick={copy} className="shrink-0">
          {copied ? <Check size={13} className="text-good" /> : <Copy size={13} />}
          {copied ? tc("copied") : tc("copy")}
        </Button>
      </div>
      <pre className="rounded-lg bg-fg text-surface text-[11.5px] p-3 overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}

function ApiOperationRow({ op }: { op: { method: "GET" | "POST"; path: string; description: string } }) {
  return (
    <div className="p-4 space-y-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Tag tone={op.method === "GET" ? "neutral" : "iris"} className="font-mono shrink-0">{op.method}</Tag>
        <code className="text-[13px] font-mono truncate">{op.path}</code>
      </div>
      <p className="text-[12.5px] text-muted">{op.description}</p>
    </div>
  );
}

function CreatedKeyModal({
  apiKey,
  apiSecret,
  signingVersion,
  onClose,
}: {
  apiKey: string;
  apiSecret: string;
  signingVersion: string;
  onClose: () => void;
}) {
  const t = useTranslations("seller");
  const tc = useTranslations("common");
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const copy = (value: string, which: "key" | "secret") => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      if (which === "key") {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 1800);
      } else {
        setCopiedSecret(true);
        setTimeout(() => setCopiedSecret(false), 1800);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <Card className="w-full max-w-[520px] p-6 flex flex-col gap-4">
        <div>
          <h3 className="text-[16px] font-semibold">{t("keyCreatedTitle")}</h3>
          <p className="text-[13px] text-bad mt-1">{t("keyCreatedWarning")}</p>
          <p className="text-[12px] text-muted mt-1">{t("signingVersionLabel")}: {signingVersion}</p>
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-[12px] text-faint mb-1">{t("publicKeyLabel")}</p>
            <div className="flex items-center gap-2 rounded-lg bg-raised border border-line px-3 py-2.5">
              <code className="flex-1 min-w-0 font-mono text-[13px] break-all">{apiKey}</code>
              <Button size="sm" variant="secondary" onClick={() => copy(apiKey, "key")} className="shrink-0">
                {copiedKey ? <Check size={14} className="text-good" /> : <Copy size={14} />}
                {copiedKey ? tc("copied") : tc("copy")}
              </Button>
            </div>
          </div>
          <div>
            <p className="text-[12px] text-faint mb-1">{t("secretKeyLabel")}</p>
            <div className="flex items-center gap-2 rounded-lg bg-raised border border-line px-3 py-2.5">
              <code className="flex-1 min-w-0 font-mono text-[13px] break-all">{apiSecret}</code>
              <Button size="sm" variant="secondary" onClick={() => copy(apiSecret, "secret")} className="shrink-0">
                {copiedSecret ? <Check size={14} className="text-good" /> : <Copy size={14} />}
                {copiedSecret ? tc("copied") : tc("copy")}
              </Button>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t("keySavedClose")}</Button>
        </div>
      </Card>
    </div>
  );
}

function RevokeConfirmModal({ onConfirm, onClose, loading }: { onConfirm: () => void; onClose: () => void; loading: boolean }) {
  const t = useTranslations("seller");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <Card className="w-full max-w-[400px] p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-[16px] font-semibold">{t("revokeTitle")}</h3>
          <p className="text-[13px] text-muted mt-1">{t("revokeBody")}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button variant="danger" onClick={onConfirm} disabled={loading}>
            {loading ? t("revoking") : t("revoke")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function SellerApiSettingsPage() {
  const t = useTranslations("seller");
  const locale = useLocale();
  const dateLocale = locale === "vi" ? "vi-VN" : "en-US";
  const { account } = useAuth();
  const operations = useApiOperations();
  const [keys, setKeys] = useState<SellerApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{ api_key: string; api_secret: string; signing_version: string } | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");

  const eligible = account?.seller_tier === "trusted" || account?.seller_tier === "enterprise";

  const load = async () => {
    setLoading(true);
    try {
      setKeys(await api.listSellerApiKeys());
    } catch {
      // Empty list for ineligible sellers or first-time users.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const res = await api.createSellerApiKey();
      // Show once in modal only — never persist secret to localStorage/sessionStorage.
      setCreatedCreds({
        api_key: res.api_key,
        api_secret: res.api_secret,
        signing_version: res.signing_version || SIGNING_VERSION,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createApiKeyFailed"));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (revokeId === null) return;
    setRevoking(true);
    try {
      await api.revokeSellerApiKey(revokeId);
      setRevokeId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("revokeFailed"));
    } finally {
      setRevoking(false);
    }
  };

  if (loading) return <div className="py-16"><Spinner /></div>;

  if (!eligible) {
    return (
      <Card className="p-8 text-center">
        <Shield size={40} className="mx-auto text-faint mb-3" />
        <h2 className="text-[16px] font-semibold mb-1.5">{t("tierRequiredTitle", { tier: MIN_TIER_LABEL })}</h2>
        <p className="text-[13px] text-muted max-w-md mx-auto">
          {t("tierRequiredApi", { tier: MIN_TIER_LABEL, current: sellerTierLabel(account?.seller_tier) })}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">{t("apiSettingsTitle")}</h2>
          <p className="text-[13px] text-muted">
            {t("apiSettingsSubtitle")}
          </p>
        </div>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? t("creatingApiKey") : t("createApiKey")}
        </Button>
      </div>

      <Card className="p-4 border-warn/25 bg-warn-soft">
        <p className="text-[13px] text-muted">
          <span className="font-semibold text-fg">{t("legacyMigrationTitle")}: </span>
          {t("legacyMigrationBody")}
        </p>
      </Card>

      {error && <p className="text-[13px] text-bad">{error}</p>}

      {keys.length === 0 ? (
        <Card className="p-8 text-center">
          <Plug size={40} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] text-muted">{t("noApiKeys")}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[12px] text-faint border-b border-line">
                <th className="font-medium px-5 py-3">{t("apiKeyCol")}</th>
                <th className="font-medium px-5 py-3">{t("signingVersionCol")}</th>
                <th className="font-medium px-5 py-3">{t("scopesCol")}</th>
                <th className="font-medium px-5 py-3">{t("createdAtCol")}</th>
                <th className="font-medium px-5 py-3">{t("expiresAtCol")}</th>
                <th className="font-medium px-5 py-3">{t("lastUsedCol")}</th>
                <th className="font-medium px-5 py-3">{t("statusCol")}</th>
                <th className="font-medium px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-0 text-[13px]">
                  <td className="px-5 py-3 font-mono">{k.key_prefix}</td>
                  <td className="px-5 py-3 text-muted font-mono">{k.signing_version || SIGNING_VERSION}</td>
                  <td className="px-5 py-3 text-muted text-[11px]">{k.scopes.join(", ")}</td>
                  <td className="px-5 py-3 text-muted">{new Date(k.created_at).toLocaleDateString(dateLocale)}</td>
                  <td className="px-5 py-3 text-muted">{new Date(k.expires_at).toLocaleDateString(dateLocale)}</td>
                  <td className="px-5 py-3 text-muted">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString(dateLocale) : t("neverUsed")}
                  </td>
                  <td className="px-5 py-3">
                    {k.revoked_at ? (
                      <span className="text-faint">{t("revokedStatus")}</span>
                    ) : new Date(k.expires_at) <= new Date() ? (
                      <span className="text-faint">{t("expiredStatus")}</span>
                    ) : (
                      <span className="text-good">{t("activeKeyStatus")}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {!k.revoked_at && new Date(k.expires_at) > new Date() && (
                      <Button size="sm" variant="ghost" onClick={() => setRevokeId(k.id)}>
                        <Trash size={14} /> {t("revoke")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div>
        <h3 className="text-[14px] font-semibold mb-1">{t("opsTitle")}</h3>
        <p className="text-[12.5px] text-muted mb-3">{t("opsSubtitle")}</p>
        <Card className="divide-y divide-line overflow-hidden">
          {operations.map((op) => (
            <ApiOperationRow key={op.path + op.method} op={op} />
          ))}
        </Card>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-[14px] font-semibold mb-1">{t("signingDocsTitle")}</h3>
          <p className="text-[12.5px] text-muted">{t("signingDocsIntro")}</p>
        </div>

        <Card className="p-4 space-y-3 text-[12.5px] text-muted">
          <p><span className="font-semibold text-fg">{t("signingHeadersTitle")}</span></p>
          <pre className="rounded-lg bg-fg text-surface text-[11.5px] p-3 overflow-x-auto whitespace-pre">{`X-API-Key: ak_live_…
X-Timestamp: <unix seconds>
X-Signature: v1=<hmac-sha256-hex>`}</pre>
          <p>{t("signingCanonicalTitle")}</p>
          <pre className="rounded-lg bg-fg text-surface text-[11.5px] p-3 overflow-x-auto whitespace-pre">{`HTTP_METHOD
RAW_PATH_WITH_QUERY
X_TIMESTAMP
SHA256_HEX(RAW_BODY)`}</pre>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t("signingRuleMethod")}</li>
            <li>{t("signingRulePath")}</li>
            <li>{t("signingRuleQuery")}</li>
            <li>{t("signingRuleBody")}</li>
            <li>{t("signingRuleTimestamp", { seconds: TIMESTAMP_TOLERANCE_SECONDS })}</li>
            <li>{t("signingRuleReplay")}</li>
          </ul>
        </Card>

        <Card className="p-4 space-y-5">
          <CodeBlock title="Python" code={PYTHON_EXAMPLE} />
          <CodeBlock title="Node.js" code={NODE_EXAMPLE} />
          <CodeBlock title="Shell / openssl" code={SHELL_EXAMPLE} />
        </Card>

        <Card className="p-4 space-y-2">
          <h4 className="text-[13px] font-semibold">{t("testVectorTitle")}</h4>
          <p className="text-[12.5px] text-muted">{t("testVectorBody")}</p>
          <pre className="rounded-lg bg-fg text-surface text-[11.5px] p-3 overflow-x-auto whitespace-pre">{`method:    ${TEST_VECTOR.method}
path:      ${TEST_VECTOR.path}
timestamp: ${TEST_VECTOR.timestamp}
body:      ${TEST_VECTOR.body}
body_hash: ${TEST_VECTOR.bodyHash}
secret:    ${TEST_VECTOR.secret}
signature: ${TEST_VECTOR.signature}`}</pre>
        </Card>
      </div>

      {createdCreds && (
        <CreatedKeyModal
          apiKey={createdCreds.api_key}
          apiSecret={createdCreds.api_secret}
          signingVersion={createdCreds.signing_version}
          onClose={() => setCreatedCreds(null)}
        />
      )}
      {revokeId !== null && (
        <RevokeConfirmModal
          loading={revoking}
          onClose={() => setRevokeId(null)}
          onConfirm={handleRevoke}
        />
      )}
    </div>
  );
}
