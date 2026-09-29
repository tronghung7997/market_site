"use client";

import { useCallback, useEffect, useState } from "react";

const KEY_PREFIX = "gmmo:restock-line1-format:";

function read(scope: string): boolean {
  try {
    return window.localStorage.getItem(KEY_PREFIX + scope) === "1";
  } catch {
    return false;
  }
}

/**
 * The seller's "line 1 is the format" box for one stock target (a package, or
 * "new-product" on the product form). Off by default; the last choice is kept
 * in this browser so the next upload to the same package starts the same way.
 */
export function useStockFormatChoice(scope: string | null): [boolean, (next: boolean) => void] {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setChecked(scope ? read(scope) : false);
  }, [scope]);
  const set = useCallback((next: boolean) => {
    setChecked(next);
    if (!scope) return;
    try {
      window.localStorage.setItem(KEY_PREFIX + scope, next ? "1" : "0");
    } catch {
      // Storage off (private window): the choice only lasts for this form.
    }
  }, [scope]);
  return [checked, set];
}
