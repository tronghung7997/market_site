// One JSON object per line on stdout, same field names as the FastAPI logs
// (marketplace-svc/src/logging.py) so both land in one searchable stream.
// Server-only: the BFF route handler imports it; never log bodies, cookies or
// tokens — only ids, the templated path, status and timing.

type Level = "info" | "warning" | "error";

const SERVICE = "frontend-bff";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_RE = /^[A-Za-z0-9_\-.]{24,}$/;

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Low-cardinality path for filtering: numeric ids, UUIDs and opaque keys become placeholders. */
export function pathTemplate(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (/^\d+$/.test(segment) || UUID_RE.test(segment)) return "{id}";
      if (OPAQUE_RE.test(segment)) return "{key}";
      return segment.slice(0, 64);
    })
    .join("/")
    .slice(0, 255);
}

// undici wraps network failures: TypeError("fetch failed") → cause with a
// `code` (ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT…), sometimes an AggregateError
// holding one error per address tried.
function describeCause(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const inner = cause instanceof AggregateError && cause.errors[0] instanceof Error ? cause.errors[0] : cause;
  const code = (inner as Error & { code?: unknown }).code;
  const message = inner.message || cause.message;
  return [typeof code === "string" ? code : inner.name, message].filter(Boolean).join(": ");
}

export function errorFields(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    const cause = describeCause(error.cause);
    return {
      error_type: error.name,
      error_message: error.message.slice(0, 500),
      ...(cause ? { error_cause: cause.slice(0, 500) } : {}),
    };
  }
  return { error_type: typeof error, error_message: String(error).slice(0, 500) };
}

export function bffLog(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: SERVICE,
    ...(process.env.DEPLOYMENT_ENVIRONMENT ? { env: process.env.DEPLOYMENT_ENVIRONMENT } : {}),
    ...(process.env.APP_VERSION ? { version: process.env.APP_VERSION } : {}),
    ...fields,
  };
  try {
    process.stdout.write(`${JSON.stringify(line)}\n`);
  } catch {
    // Logging must never break a request.
  }
}
