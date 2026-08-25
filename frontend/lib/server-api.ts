const LOCAL_API_BASE = "http://localhost:8001";

/**
 * Resolve the backend origin used by Next server code.
 *
 * Production standalone builds embed BUILT_API_URL because a copied runtime
 * .env may still contain a development API_URL. Keep this precedence shared
 * by every server-side caller so SSR and the BFF cannot target different APIs.
 */
export function resolveServerApiBase(
  builtApiUrl: string | undefined,
  runtimeApiUrl: string | undefined,
): string {
  const configured = [builtApiUrl, runtimeApiUrl]
    .find((value) => value?.trim())
    ?.trim();
  return (configured ?? LOCAL_API_BASE).replace(/\/+$/, "");
}

export const SERVER_API_BASE = resolveServerApiBase(
  process.env.BUILT_API_URL,
  process.env.API_URL,
);
