"use client";

import { useEffect, useRef } from "react";

/** A list whose last rows went away (bulk pause, answered questions, deleted
 *  stock) can leave the viewer on a page past the end — empty, and with no
 *  pager to get back since one page needs none. Move them to the last page. */
export function usePageClamp(
  page: number,
  total: number | null | undefined,
  perPage: number,
  onClamp: (lastPage: number) => void,
) {
  const onClampRef = useRef(onClamp);
  onClampRef.current = onClamp;
  useEffect(() => {
    if (total == null || page <= 1) return;
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    if (page > lastPage) onClampRef.current(lastPage);
  }, [page, total, perPage]);
}
