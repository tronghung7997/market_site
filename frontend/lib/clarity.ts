/** Microsoft Clarity project ids are short alphanumerics. Shared by the admin
 *  form and the server layout so a bad value never reaches the inline snippet. */
export function isValidClarityId(raw: string): boolean {
  return /^[a-z0-9]{6,20}$/i.test(raw);
}
