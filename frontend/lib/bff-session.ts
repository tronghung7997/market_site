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
