import { emptyStore, parseStore } from "./score.ts";
import type { AuditStore, Verdict } from "./types.ts";

export const SITE_AUDIT_STORAGE_KEY = "proxora.site-audit.v1";

export function loadStore(): AuditStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(SITE_AUDIT_STORAGE_KEY);
    return raw ? parseStore(JSON.parse(raw)) : emptyStore();
  } catch {
    return emptyStore();
  }
}

export function saveStore(store: AuditStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SITE_AUDIT_STORAGE_KEY, JSON.stringify(store));
}

export function setVerdict(store: AuditStore, id: string, verdict: Verdict | null): AuditStore {
  const verdicts = { ...store.verdicts };
  if (verdict) verdicts[id] = verdict;
  else delete verdicts[id];
  return { ...store, version: 1, updatedAt: new Date().toISOString(), verdicts };
}

export function setNote(store: AuditStore, id: string, note: string): AuditStore {
  const notes = { ...store.notes };
  if (note.trim()) notes[id] = note;
  else delete notes[id];
  return { ...store, version: 1, updatedAt: new Date().toISOString(), notes };
}
