// The address a strict sign-up must confirm, kept for this tab only so the
// "check your inbox" screen can show it and resend without a session.
// Never put it in the URL (addresses end up in logs and history).
const KEY = "auth.pendingVerificationEmail";

export function rememberPendingVerification(email: string) {
  try {
    sessionStorage.setItem(KEY, email);
  } catch {
    // Storage blocked: the page falls back to the generic message.
  }
}

export function readPendingVerification(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetPendingVerification() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
