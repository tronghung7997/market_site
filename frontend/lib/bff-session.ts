export const ACCESS_COOKIE = "dx_session";
export const REFRESH_COOKIE = "dx_refresh";

export const ACCESS_MAX_AGE_SECONDS = 15 * 60;
export const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function authCookieOptions(maxAge: number, isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

export type IssuedAuthTokens = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
};

export function tokensFromLoginPayload(payload: IssuedAuthTokens): {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
} | null {
  if (!payload.access_token || !payload.refresh_token) return null;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type ?? "bearer",
  };
}

/**
 * Why a refresh-token rotation failed. Only a verdict on the token itself
 * (`rejected`) may end the session: a throttled or unreachable backend must
 * leave the cookies alone so the next request simply retries the refresh.
 * `null` = the backend never answered, or answered 2xx without tokens.
 */
export type RefreshFailure = "rejected" | "rate_limited" | "unavailable";

export function refreshFailureKind(status: number | null): RefreshFailure {
  if (status === 401 || status === 403 || status === 422) return "rejected";
  if (status === 429) return "rate_limited";
  return "unavailable";
}

/**
 * Strict sign-up handoff: the secret that lets the browser which signed up be
 * signed in once the mailbox is confirmed (opening the link there, or the
 * "check your inbox" screen polling after a confirmation on another device).
 * HttpOnly and scoped to the auth API; the backend enforces the real expiry.
 */
export const SIGNUP_COOKIE = "dx_signup";
export const SIGNUP_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Backend paths that take the handoff from this browser's cookie. */
export const SIGNUP_HANDOFF_PATHS = new Set(["auth/verify-email", "auth/signup-handoff/claim"]);

export function signupCookieOptions(isProduction: boolean) {
  return { ...authCookieOptions(SIGNUP_MAX_AGE_SECONDS, isProduction), path: "/api/auth" };
}

/**
 * The browser's JSON body with the cookie's handoff set (any value the page
 * sent itself is overwritten: only the cookie counts). Null when the body is
 * not a JSON object.
 */
export function bodyWithSignupHandoff(body: ArrayBuffer | undefined, handoff: string | undefined): ArrayBuffer | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body ?? new ArrayBuffer(0)) || "{}");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const next: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  delete next.handoff;
  if (handoff) next.handoff = handoff;
  return new TextEncoder().encode(JSON.stringify(next)).buffer as ArrayBuffer;
}
