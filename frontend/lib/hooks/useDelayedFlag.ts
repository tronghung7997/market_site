import { useEffect, useState } from "react";

/** `true` only once `flag` has stayed on for `delay` ms, and `false` as soon as
 * it turns off — for dimming stale data during a refetch without flashing on
 * responses that come back almost immediately. */
export function useDelayedFlag(flag: boolean, delay = 150): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [flag, delay]);
  return flag && shown;
}
