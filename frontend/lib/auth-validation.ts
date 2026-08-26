export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const BCRYPT_MAX_BYTES = 72;

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function passwordBytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export type ResetPasswordIssue = "min" | "mismatch" | "byte" | "required";

export function validateResetPassword(
  password: string,
  confirm: string,
): ResetPasswordIssue | null {
  if (!password) return "required";
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return "min";
  if (passwordBytes(password) > BCRYPT_MAX_BYTES) return "byte";
  if (password !== confirm) return "mismatch";
  return null;
}
