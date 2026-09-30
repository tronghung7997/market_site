/** Long product/variant names read as their attributes: "Tài khoản Facebook
 *  (mail recovery, 2FA, >50 friend, ngâm trên 2 tháng)" → its comma/bracket
 *  separated parts. Lets a list show only what sets a variant apart instead of
 *  cutting the name. */

function norm(token: string): string {
  return token.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function nameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  return name.split(/[,;|()[\]]+/).map((part) => part.trim()).filter(Boolean);
}

/** Parts of `variant` that `title` does not already say, in order. Empty when
 *  the variant only repeats the title. */
export function distinctTokens(variant: string | null | undefined, title: string | null | undefined): string[] {
  const known = new Set(nameTokens(title).map(norm));
  const seen = new Set<string>();
  return nameTokens(variant).filter((token) => {
    const key = norm(token);
    if (known.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
