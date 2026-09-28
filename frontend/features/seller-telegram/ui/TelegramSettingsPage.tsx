"use client";

/** Seller › Telegram: the shop connects its own bot (made with @BotFather),
 *  links the chats that should receive notifications with a one-time code,
 *  and picks which events are sent. The token never comes back from the API. */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { SellerTelegramChat, SellerTelegramEvent, SellerTelegramLinkCode, SellerTelegramState } from "@/lib/types";
import {
  Banner, Button, buttonClass, Card, CopyButton, Field, InlineNotice, Input, Skeleton, Switch, Tag,
} from "@/components/ui";
import { AlertTriangle, Check, ExternalLink, Info, Trash } from "@/components/Icons";
import {
  formatCountdown, linkedChatCount, looksLikeBotToken, needsFirstChat, secondsLeft, TELEGRAM_EVENT_LEVEL, TELEGRAM_EVENTS,
} from "../model";

const STATE_KEY = ["seller", "telegram"] as const;
const BOTFATHER_URL = "https://t.me/BotFather";

export function TelegramSettingsPage() {
  const t = useTranslations("seller.telegram");
  const state = useQuery({ queryKey: STATE_KEY, queryFn: () => api.sellerTelegram() });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-[24px] font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-0.5 max-w-[720px] text-[12.5px] text-muted">{t("subtitle")}</p>
      </div>
      {state.isPending ? (
        <div className="space-y-4" aria-hidden><Skeleton className="h-40" /><Skeleton className="h-64" /></div>
      ) : state.isError || !state.data ? (
        <Card className="flex items-center justify-between gap-3 p-5 text-[13px]">
          <span className="text-bad">{t("loadFailed")}</span>
          <Button size="sm" variant="secondary" onClick={() => state.refetch()}>{t("retry")}</Button>
        </Card>
      ) : state.data.connected ? (
        <ConnectedView state={state.data} />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <BotFatherGuide />
          <TokenForm />
        </div>
      )}
      <p className="flex max-w-[720px] items-start gap-1.5 text-[12px] leading-relaxed text-faint">
        <Info size={13} className="mt-0.5 shrink-0" /> {t("privacy")}
      </p>
    </div>
  );
}

function BotFatherGuide() {
  const t = useTranslations("seller.telegram.guide");
  const steps = ["open", "newbot", "name", "username", "token"] as const;
  return (
    <Card className="p-5">
      <h2 className="text-[16px] font-semibold">{t("title")}</h2>
      <p className="mt-0.5 text-[12.5px] text-muted">{t("subtitle")}</p>
      <ol className="mt-4 space-y-4">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fg font-mono text-[11px] font-semibold text-surface">
              {index + 1}
            </span>
            <div className="min-w-0 space-y-1 text-[13px] leading-relaxed">
              <p className="font-medium">{t(`${step}.title`)}</p>
              <p className="text-muted">
                {t.rich(`${step}.body`, { code: (chunks) => <code className="rounded bg-raised px-1 font-mono text-[12px] text-fg">{chunks}</code> })}
              </p>
              {step === "open" && (
                <a href={BOTFATHER_URL} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
                  {t("openBotFather")} <ExternalLink size={12} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <Banner tone="warn" icon={<AlertTriangle size={14} />} className="mt-5">{t("secret")}</Banner>
    </Card>
  );
}

/** Paste a BotFather token. Also used to replace the token of a connected bot. */
function TokenForm({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const t = useTranslations("seller.telegram.token");
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [localError, setLocalError] = useState("");
  const connect = useMutation({
    mutationFn: (replaceWebhook: boolean) => api.connectSellerTelegram(token.trim(), replaceWebhook),
    onSuccess: (next) => {
      queryClient.setQueryData(STATE_KEY, next);
      setToken("");
      onDone?.();
    },
  });
  const webhookConflict = connect.error instanceof ApiError && connect.error.errorCode === "TELEGRAM_WEBHOOK_IN_USE";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!looksLikeBotToken(token)) {
      setLocalError(t("formatHint"));
      return;
    }
    setLocalError("");
    connect.mutate(false);
  };

  return (
    <Card className={compact ? "p-4" : "p-5 lg:sticky lg:top-4"}>
      {!compact && <h2 className="mb-3 text-[16px] font-semibold">{t("title")}</h2>}
      <form onSubmit={submit} className="space-y-3">
        <Field label={t("label")} hint={t("hint")} error={localError || undefined}>
          <Input
            value={token}
            onChange={(event) => { setToken(event.target.value); setLocalError(""); connect.reset(); }}
            placeholder="123456789:AA…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!localError || undefined}
            className="font-mono text-[13px]"
          />
        </Field>
        {webhookConflict ? (
          <Banner tone="warn" icon={<AlertTriangle size={14} />} title={t("webhookTitle")}>
            <p>{t("webhookBody")}</p>
            <Button type="button" size="sm" variant="secondary" className="mt-2" loading={connect.isPending}
              onClick={() => connect.mutate(true)}>
              {t("webhookReplace")}
            </Button>
          </Banner>
        ) : connect.isError ? (
          <InlineNotice tone="bad" icon={<AlertTriangle size={13} />}>{errorMessage(connect.error)}</InlineNotice>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={connect.isPending} disabled={!token.trim()}>{t("submit")}</Button>
          {onDone && <Button type="button" variant="ghost" onClick={onDone}>{t("cancel")}</Button>}
        </div>
        {!compact && <p className="text-[12px] leading-relaxed text-faint">{t("storage")}</p>}
      </form>
    </Card>
  );
}

function ConnectedView({ state }: { state: SellerTelegramState }) {
  const t = useTranslations("seller.telegram");
  const [replacingToken, setReplacingToken] = useState(false);
  const firstChat = needsFirstChat(state);

  return (
    <div className="space-y-5">
      {state.status === "paused" && (
        <Banner tone="bad" icon={<AlertTriangle size={14} />} title={t("paused.title")}
          action={state.paused_reason === "token_rejected" && !replacingToken
            ? <Button size="sm" variant="secondary" onClick={() => setReplacingToken(true)}>{t("paused.newToken")}</Button>
            : undefined}>
          {t(`paused.${state.paused_reason ?? "no_chats"}`)}
        </Banner>
      )}
      <BotCard state={state} replacingToken={replacingToken} onReplaceToken={setReplacingToken} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ChatsCard state={state} openLink={firstChat} />
        <EventsCard state={state} />
      </div>
    </div>
  );
}

function BotCard({ state, replacingToken, onReplaceToken }: {
  state: SellerTelegramState; replacingToken: boolean; onReplaceToken: (open: boolean) => void;
}) {
  const t = useTranslations("seller.telegram");
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const hasActiveChat = state.chats.some((chat) => chat.status === "active");
  const test = useMutation({ mutationFn: () => api.testSellerTelegram() });
  const disconnect = useMutation({
    mutationFn: () => api.disconnectSellerTelegram(),
    onSuccess: (next) => queryClient.setQueryData(STATE_KEY, next),
  });
  const bot = state.bot!;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold">{bot.name || bot.username}</h2>
            <Tag tone={state.status !== "active" ? "bad" : hasActiveChat ? "good" : "neutral"}>
              {state.status !== "active" ? t("bot.paused") : hasActiveChat ? t("bot.active") : t("bot.noChat")}
            </Tag>
          </div>
          <p className="mt-1 font-mono text-[12.5px] text-muted">
            <a href={`https://t.me/${bot.username}`} target="_blank" rel="noopener noreferrer" className="hover:text-iris-hi hover:underline">
              @{bot.username}
            </a>
            <span className="mx-2 text-faint">·</span>
            <span title={t("bot.tokenHintTitle")}>{t("bot.token")} {bot.token_hint}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!hasActiveChat} loading={test.isPending} onClick={() => test.mutate()}>
            {t("bot.test")}
          </Button>
          {!replacingToken && (
            <Button size="sm" variant="ghost" onClick={() => onReplaceToken(true)}>{t("bot.replaceToken")}</Button>
          )}
          {confirmDisconnect ? (
            <span className="flex items-center gap-2">
              <Button size="sm" variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                {t("bot.disconnectConfirm")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>{t("cancel")}</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" className="text-bad hover:text-bad" onClick={() => setConfirmDisconnect(true)}>
              {t("bot.disconnect")}
            </Button>
          )}
        </div>
      </div>
      {confirmDisconnect && <p className="mt-3 text-[12.5px] text-muted">{t("bot.disconnectHint")}</p>}
      {test.isSuccess && (
        <InlineNotice tone={test.data.failed.length ? "warn" : "good"} icon={<Check size={13} />} className="mt-3">
          {test.data.failed.length
            ? t("bot.testPartial", { delivered: test.data.delivered.length, failed: test.data.failed.length })
            : t("bot.testSent", { count: test.data.delivered.length })}
        </InlineNotice>
      )}
      {(test.isError || disconnect.isError) && (
        <InlineNotice tone="bad" icon={<AlertTriangle size={13} />} className="mt-3">
          {errorMessage(test.error ?? disconnect.error)}
        </InlineNotice>
      )}
      {replacingToken && (
        <div className="mt-4 max-w-[480px]">
          <TokenForm compact onDone={() => onReplaceToken(false)} />
        </div>
      )}
    </Card>
  );
}

function ChatsCard({ state, openLink }: { state: SellerTelegramState; openLink: boolean }) {
  const t = useTranslations("seller.telegram.chats");
  const [linking, setLinking] = useState(openLink);
  const full = linkedChatCount(state) >= state.max_chats;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-semibold">{t("title")}</h2>
        <span className="font-mono text-[12px] text-muted">{linkedChatCount(state)}/{state.max_chats}</span>
      </div>
      {state.chats.length > 0 ? (
        <ul className="divide-y divide-line">
          {state.chats.map((chat) => <ChatRow key={chat.key} chat={chat} />)}
        </ul>
      ) : (
        <p className="px-5 py-4 text-[13px] text-muted">{t("empty")}</p>
      )}
      <div className="border-t border-line px-5 py-4">
        {linking ? (
          <LinkPanel onLinked={() => setLinking(false)} onClose={state.chats.length ? () => setLinking(false) : undefined} />
        ) : (
          <Button size="sm" variant="secondary" disabled={full} onClick={() => setLinking(true)}>
            {full ? t("full", { max: state.max_chats }) : t("add")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function ChatRow({ chat }: { chat: SellerTelegramChat }) {
  const t = useTranslations("seller.telegram.chats");
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const onState = (next: SellerTelegramState) => queryClient.setQueryData(STATE_KEY, next);
  const confirm = useMutation({ mutationFn: () => api.confirmSellerTelegramChat(chat.key), onSuccess: onState });
  const remove = useMutation({ mutationFn: () => api.removeSellerTelegramChat(chat.key), onSuccess: onState });
  const kind = chat.type === "private" ? "private" : chat.type === "channel" ? "channel" : "group";
  const tone = chat.status === "active" ? "good" : chat.status === "pending" ? "warn" : "bad";

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium">{chat.title || t(`kinds.${kind}`)}</p>
          <p className="text-[12px] text-muted">{t(`kinds.${kind}`)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Tag tone={tone}>{t(`status.${chat.status}`)}</Tag>
          {chat.status === "pending" && (
            <Button size="sm" loading={confirm.isPending} onClick={() => confirm.mutate()}>{t("confirm")}</Button>
          )}
          <Button size="sm" variant="ghost" aria-label={t("remove", { title: chat.title })} loading={remove.isPending}
            onClick={() => remove.mutate()}>
            <Trash size={14} />
          </Button>
        </div>
      </div>
      {chat.status === "pending" && <p className="mt-1.5 text-[12px] text-muted">{t("pendingHint")}</p>}
      {chat.status === "broken" && <p className="mt-1.5 text-[12px] text-bad">{t("brokenHint")}</p>}
      {(confirm.isError || remove.isError) && (
        <InlineNotice tone="bad" icon={<AlertTriangle size={13} />} className="mt-2">
          {errorMessage(confirm.error ?? remove.error)}
        </InlineNotice>
      )}
    </li>
  );
}

/** One-time code: open the bot with it (private chat) or send it in a group.
 *  Polls every 3 s until the bot receives it or the code expires. */
function LinkPanel({ onClose, onLinked }: { onClose?: () => void; onLinked: () => void }) {
  const t = useTranslations("seller.telegram.link");
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const [code, setCode] = useState<SellerTelegramLinkCode | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const start = useMutation({
    mutationFn: () => api.startSellerTelegramLink(),
    onSuccess: (next) => { setCode(next); setNow(Date.now()); },
  });
  const left = secondsLeft(code?.expires_at, now);
  const waiting = !!code && left > 0;
  const poll = useQuery({
    queryKey: [...STATE_KEY, "link", code?.code],
    queryFn: () => api.pollSellerTelegramLink(),
    enabled: waiting,
    refetchInterval: 3000,
    retry: false,
  });

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  useEffect(() => {
    if (poll.data?.status === "linked") {
      setCode(null);
      void queryClient.invalidateQueries({ queryKey: STATE_KEY, exact: true });
      onLinked();
    }
  }, [poll.data?.status, queryClient, onLinked]);

  if (!code || poll.data?.status === "expired" || left === 0) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-muted">{code ? t("expired") : t("intro")}</p>
        {start.isError && (
          <InlineNotice tone="bad" icon={<AlertTriangle size={13} />}>{errorMessage(start.error)}</InlineNotice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={start.isPending} onClick={() => start.mutate()}>
            {code ? t("newCode") : t("start")}
          </Button>
          {onClose && <Button size="sm" variant="ghost" onClick={onClose}>{t("close")}</Button>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px]">
          {t("code")} <span className="font-mono text-[18px] font-semibold tracking-[0.2em] tabular">{code.code}</span>
        </p>
        <span className="font-mono text-[12px] text-muted tabular" aria-live="off">{t("expiresIn", { time: formatCountdown(left) })}</span>
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-medium">{t("privateTitle")}</p>
        <a href={code.deep_link} target="_blank" rel="noopener noreferrer" className={buttonClass({ size: "md" })}>
          {t("openBot")} <ExternalLink size={13} />
        </a>
        <p className="text-[12.5px] text-muted">{t("privateHint")}</p>
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-medium">{t("groupTitle")}</p>
        <p className="text-[12.5px] text-muted">{t("groupHint")}</p>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[12.5px]">{code.group_command}</code>
          <CopyButton text={code.group_command} />
        </div>
      </div>
      <p className="flex items-center gap-2 text-[12.5px] text-muted" role="status">
        <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-line-2 border-t-iris" />
        {poll.isError ? errorMessage(poll.error) : t("waiting")}
      </p>
      {onClose && <Button size="sm" variant="ghost" onClick={() => { setCode(null); onClose(); }}>{t("close")}</Button>}
    </div>
  );
}

function EventsCard({ state }: { state: SellerTelegramState }) {
  const t = useTranslations("seller.telegram.events");
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (change: Partial<Record<SellerTelegramEvent, boolean>>) => api.updateSellerTelegramEvents(change),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: STATE_KEY, exact: true });
      const previous = queryClient.getQueryData<SellerTelegramState>(STATE_KEY);
      if (previous) queryClient.setQueryData(STATE_KEY, { ...previous, events: { ...previous.events, ...change } });
      return { previous };
    },
    onError: (_error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(STATE_KEY, context.previous);
    },
    onSuccess: (next) => queryClient.setQueryData(STATE_KEY, next),
  });

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-semibold">{t("title")}</h2>
        <p className="mt-0.5 text-[12px] text-muted">{t("subtitle")}</p>
      </div>
      <ul className="divide-y divide-line">
        {TELEGRAM_EVENTS.map((event) => (
          <li key={event} className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                {t(`${event}.label`)}
                <Tag tone={TELEGRAM_EVENT_LEVEL[event]}>{t(`levels.${TELEGRAM_EVENT_LEVEL[event]}`)}</Tag>
              </p>
              <p className="mt-0.5 text-[12px] text-muted">{t(`${event}.hint`)}</p>
            </div>
            <Switch
              checked={state.events[event]}
              label={t(`${event}.label`)}
              disabled={update.isPending}
              onChange={(next) => update.mutate({ [event]: next })}
            />
          </li>
        ))}
      </ul>
      {update.isError && (
        <div className="border-t border-line px-5 py-3">
          <InlineNotice tone="bad" icon={<AlertTriangle size={13} />}>{errorMessage(update.error)}</InlineNotice>
        </div>
      )}
    </Card>
  );
}
