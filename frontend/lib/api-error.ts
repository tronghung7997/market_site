import enMessages from "../messages/en.json" with { type: "json" };
import viMessages from "../messages/vi.json" with { type: "json" };

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";
export const NETWORK_ERROR_MESSAGE = "Unable to reach the server. Check your connection and try again.";
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

export class ApiError extends Error {
  status: number;
  errorCode?: string;
  params: Record<string, unknown>;
  constructor(status: number, message: string, errorCode?: string, params: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.params = params;
  }
}

/** Older BFF/backend strings that predate error_code. Keep mapping them so
 * English UI never falls through to UNKNOWN when the body is still Vietnamese. */
const LEGACY_DETAIL_CODES: Record<string, string> = {
  "Cross-site request bị từ chối": "CSRF_REJECTED",
  "Backend tạm thời không khả dụng": "BACKEND_UNAVAILABLE",
  "Phản hồi đăng nhập không hợp lệ": "INVALID_LOGIN_RESPONSE",
  "Token không hợp lệ": "SESSION_EXPIRED",
  "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn": "PASSWORD_RESET_INVALID",
  "Administrator accounts must use the private admin sign-in": "ADMIN_LOGIN_REQUIRED",
  "This sign-in is restricted to administrator accounts": "ADMIN_ONLY",
};

function catalogDetailCodes(): Record<string, string> {
  const map: Record<string, string> = { ...LEGACY_DETAIL_CODES };
  for (const catalog of [enMessages.errors, viMessages.errors]) {
    for (const [code, message] of Object.entries(catalog)) {
      if (typeof message !== "string" || message.includes("{")) continue;
      map[message] = code;
    }
  }
  return map;
}

const DETAIL_ERROR_CODES = catalogDetailCodes();

function routePath(path: string): string {
  const query = path.indexOf("?");
  return query === -1 ? path : path.slice(0, query);
}

export function rawResponseDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown; message?: unknown }).detail
    ?? (body as { message?: unknown }).message;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && typeof (detail[0] as { msg?: unknown } | undefined)?.msg === "string") {
    return (detail[0] as { msg: string }).msg.replace(/^Value error,\s*/i, "");
  }
  return null;
}

export function localizedResponseDetail(message: string | null, locale: string): string | null {
  return locale === "en" && message && /[À-ỹĐđ]/.test(message) ? null : message;
}

export function errorCodeFromResponse(path: string, status: number, body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const code = (body as { error_code?: unknown }).error_code;
    if (typeof code === "string" && code) return code;
  }
  const detail = rawResponseDetail(body);
  if (detail && DETAIL_ERROR_CODES[detail]) return DETAIL_ERROR_CODES[detail];
  const route = routePath(path);
  if (status === 401 && (route === "/auth/login" || route === "/auth/admin/login")) {
    return "INVALID_CREDENTIALS";
  }
  if (status === 409 && route === "/auth/register") return "DUPLICATE_EMAIL";
  if (status === 429 && route.startsWith("/auth/")) return "AUTH_RATE_LIMITED";
  if (status === 400 && route === "/auth/reset-password") return "PASSWORD_RESET_INVALID";
  return undefined;
}

export function apiErrorFromResponse(
  path: string,
  status: number,
  body: unknown,
  options: { auth?: boolean | "silent"; locale?: string } = {},
): ApiError {
  if (status === 401 && options.auth) {
    return new ApiError(401, SESSION_EXPIRED_MESSAGE, "SESSION_EXPIRED");
  }
  const locale = options.locale ?? "en";
  const detail = localizedResponseDetail(rawResponseDetail(body), locale);
  const params = body && typeof body === "object"
    && typeof (body as { params?: unknown }).params === "object"
    && (body as { params: unknown }).params !== null
    ? (body as { params: Record<string, unknown> }).params
    : {};
  return new ApiError(
    status,
    detail ?? GENERIC_ERROR_MESSAGE,
    errorCodeFromResponse(path, status, body),
    params,
  );
}

export function isGenericErrorMessage(message: string): boolean {
  return message === GENERIC_ERROR_MESSAGE;
}
