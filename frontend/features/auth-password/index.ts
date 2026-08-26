import { api } from "@/lib/api";

export {
  PASSWORD_MIN_LENGTH,
  validateResetPassword,
  type ResetPasswordIssue,
} from "@/lib/auth-validation";

export function requestPasswordReset(email: string, locale: string) {
  return api.forgotPassword(email, locale);
}

export function confirmPasswordReset(token: string, password: string) {
  return api.resetPassword(token, password);
}
