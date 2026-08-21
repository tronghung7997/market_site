export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const BCRYPT_MAX_BYTES = 72;

const COMMON_PASSWORDS = new Set([
  "123456789012",
  "adminadmin12",
  "letmein12345",
  "password1234",
  "qwerty123456",
]);

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function passwordBytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function isCommonPassword(value: string): boolean {
  return COMMON_PASSWORDS.has(value.toLocaleLowerCase());
}
