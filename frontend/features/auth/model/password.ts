// Relative so the model stays loadable by the node test runner (no path alias there).
import {
  BCRYPT_MAX_BYTES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isValidEmail,
  passwordBytes,
} from "../../../lib/auth-validation.ts";

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

/**
 * Coarse strength for the sign-up meter. Not a policy: the only hard rules
 * are the length/byte limits shared with the backend. Scores length first
 * (the thing that actually matters) and variety second, and treats an
 * obviously repeated string ("aaaaaaaa") as weak.
 */
export function passwordStrength(value: string): PasswordStrength {
  if (!value) return 0;
  const len = value.length;
  const classes =
    Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) + Number(/\d/.test(value)) + Number(/[^A-Za-z0-9]/.test(value));
  const distinct = new Set(value).size;
  if (len < PASSWORD_MIN_LENGTH || distinct <= 2) return 1;
  let score = 1;
  if (len >= 10) score += 1;
  if (len >= 14) score += 1;
  if (classes >= 3) score += 1;
  else if (classes === 2 && len >= 12) score += 1;
  return Math.min(4, score) as PasswordStrength;
}

export type SignUpIssue = "required" | "min" | "max" | "byte";

export function validateNewPassword(value: string): SignUpIssue | null {
  if (!value) return "required";
  if (value.length < PASSWORD_MIN_LENGTH) return "min";
  if (value.length > PASSWORD_MAX_LENGTH) return "max";
  if (passwordBytes(value) > BCRYPT_MAX_BYTES) return "byte";
  return null;
}

export type EmailIssue = "required" | "invalid";

export function validateEmail(value: string): EmailIssue | null {
  if (!value.trim()) return "required";
  if (!isValidEmail(value)) return "invalid";
  return null;
}
