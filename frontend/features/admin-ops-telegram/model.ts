// Admin › Settings › Ops bot: form model (no React, testable with node:test).
import type { OpsTelegramConfig, OpsTelegramEvent, OpsTelegramUpdate } from "../../lib/types";

export const OPS_EVENTS: OpsTelegramEvent[] = [
  "withdrawal_requested", "dispute_opened", "dispute_timeout", "deposit_unmatched",
  "deposit_anomaly", "site_switch", "system_alert", "seller_application",
];

export const INTERVAL_RANGE = { min: 5, max: 1440 } as const;

const TOKEN_RE = /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_RE = /^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

export interface OpsForm {
  enabled: boolean;
  /** Pasted token; "" = keep the stored one. */
  token: string;
  clearToken: boolean;
  opsChat: string;
  channelChat: string;
  channelEnabled: boolean;
  interval: string;
  events: Record<OpsTelegramEvent, boolean>;
  quiet: boolean;
}

export function toForm(cfg: OpsTelegramConfig): OpsForm {
  return {
    enabled: cfg.enabled,
    token: "",
    clearToken: false,
    opsChat: cfg.ops_chat_id,
    channelChat: cfg.channel_chat_id,
    channelEnabled: cfg.channel_enabled,
    interval: String(cfg.channel_interval_minutes),
    events: { ...cfg.events },
    quiet: cfg.quiet_low_priority,
  };
}

export const looksLikeToken = (value: string) => TOKEN_RE.test(value.trim());
export const validChat = (value: string) => value.trim() === "" || CHAT_RE.test(value.trim());

export function intervalOk(raw: string): boolean {
  if (!/^\d+$/.test(raw)) return false;
  const n = Number(raw);
  return n >= INTERVAL_RANGE.min && n <= INTERVAL_RANGE.max;
}

export type OpsProblem = "token" | "opsChat" | "channelChat" | "interval" | "incomplete";

/** Why the draft cannot be saved yet (empty = savable). */
export function problems(form: OpsForm, cfg: OpsTelegramConfig): OpsProblem[] {
  const out: OpsProblem[] = [];
  if (form.token.trim() && !looksLikeToken(form.token)) out.push("token");
  if (!validChat(form.opsChat)) out.push("opsChat");
  if (!validChat(form.channelChat)) out.push("channelChat");
  if (!intervalOk(form.interval)) out.push("interval");
  const hasToken = form.clearToken ? false : Boolean(form.token.trim()) || cfg.token_set;
  if (form.enabled && (!hasToken || !(form.opsChat.trim() || form.channelChat.trim()))) out.push("incomplete");
  return out;
}

export function isDirty(form: OpsForm, cfg: OpsTelegramConfig): boolean {
  return JSON.stringify(form) !== JSON.stringify(toForm(cfg));
}

/** Only the changed fields; the token is sent only when typed or cleared. */
export function toUpdate(form: OpsForm, cfg: OpsTelegramConfig): OpsTelegramUpdate {
  const body: OpsTelegramUpdate = {};
  if (form.enabled !== cfg.enabled) body.enabled = form.enabled;
  if (form.clearToken) body.bot_token = "";
  else if (form.token.trim()) body.bot_token = form.token.trim();
  if (form.opsChat.trim() !== cfg.ops_chat_id) body.ops_chat_id = form.opsChat.trim();
  if (form.channelChat.trim() !== cfg.channel_chat_id) body.channel_chat_id = form.channelChat.trim();
  if (form.channelEnabled !== cfg.channel_enabled) body.channel_enabled = form.channelEnabled;
  if (Number(form.interval) !== cfg.channel_interval_minutes) body.channel_interval_minutes = Number(form.interval);
  const events = Object.fromEntries(OPS_EVENTS.filter((k) => form.events[k] !== cfg.events[k]).map((k) => [k, form.events[k]]));
  if (Object.keys(events).length) body.events = events;
  if (form.quiet !== cfg.quiet_low_priority) body.quiet_low_priority = form.quiet;
  return body;
}

export type BotState = "off" | "running" | "paused" | "noToken";

export function botState(cfg: OpsTelegramConfig): BotState {
  if (!cfg.token_set) return "noToken";
  if (cfg.status === "paused") return "paused";
  return cfg.enabled ? "running" : "off";
}
