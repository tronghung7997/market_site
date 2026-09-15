"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { facebookShortQuery, normalizeFacebookTarget, type FacebookTarget } from "@/lib/facebook-lookup";
import type { FacebookLookupResponse } from "@/lib/types";
import { parseRecent, RECENT_STORAGE_KEY, rememberLookup, type RecentLookup } from "./model";

export type LookupFailure = { code: "empty" | "invalid" | "api"; cause?: unknown };

/** Lookup state machine: one in-flight request at a time (older ones are
 *  aborted), `?q=` deep links run on mount and the address bar mirrors the
 *  last successful query so a result can be shared by URL. */
export function useFacebookLookup() {
  const searchParams = useSearchParams();
  const [value, setValue] = useState(() => searchParams.get("q") ?? "");
  const [result, setResult] = useState<FacebookLookupResponse | null>(null);
  const [failure, setFailure] = useState<LookupFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<RecentLookup[]>([]);
  const inflight = useRef<AbortController | null>(null);
  const bootRan = useRef(false);

  const target: FacebookTarget | null = useMemo(() => normalizeFacebookTarget(value), [value]);

  useEffect(() => {
    try { setRecent(parseRecent(window.localStorage.getItem(RECENT_STORAGE_KEY))); } catch { /* storage blocked */ }
  }, []);

  const persistRecent = (next: RecentLookup[]) => {
    setRecent(next);
    try { window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  };

  const syncUrl = (handle: string | null) => {
    const url = new URL(window.location.href);
    if (handle) url.searchParams.set("q", handle); else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  };

  const cancel = useCallback(() => {
    inflight.current?.abort();
    inflight.current = null;
    setLoading(false);
  }, []);

  const lookup = useCallback(async (raw?: string) => {
    const input = (raw ?? value).trim();
    if (raw != null) setValue(raw);
    if (!input) { setFailure({ code: "empty" }); setResult(null); return; }
    const next = normalizeFacebookTarget(input);
    if (!next) { setFailure({ code: "invalid" }); setResult(null); return; }

    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true); setFailure(null); setResult(null);
    try {
      const data = await api.facebookLookup(next.url, controller.signal);
      if (controller.signal.aborted) return;
      setResult(data);
      syncUrl(facebookShortQuery(next));
      persistRecent(rememberLookup(parseRecent(safeRead()), data));
    } catch (cause) {
      if (controller.signal.aborted || (cause as Error)?.name === "AbortError") return;
      setFailure({ code: "api", cause });
    } finally {
      if (inflight.current === controller) { inflight.current = null; setLoading(false); }
    }
  }, [value]);

  // Deep link: /solutions/facebook-id?q=bui.v.phu
  useEffect(() => {
    if (bootRan.current) return;
    bootRan.current = true;
    const q = searchParams.get("q");
    if (q) void lookup(q);
  }, [searchParams, lookup]);

  const reset = useCallback(() => {
    cancel();
    setValue(""); setResult(null); setFailure(null);
    syncUrl(null);
  }, [cancel]);

  const clearRecent = useCallback(() => persistRecent([]), []);

  return { value, setValue, target, result, failure, loading, recent, lookup, cancel, reset, clearRecent };
}

function safeRead(): string | null {
  try { return window.localStorage.getItem(RECENT_STORAGE_KEY); } catch { return null; }
}

export function failureStatus(failure: LookupFailure | null): number | null {
  return failure?.cause instanceof ApiError ? failure.cause.status : null;
}
