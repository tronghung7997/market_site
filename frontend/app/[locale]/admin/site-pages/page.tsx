"use client";
/* Hallmark · component: admin site pages (footer/legal markdown) · theme: project Proxora (slate canvas · iris accent) · P4 H4 E4 S4 R4 V4 */

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Eye, EyeOff, PencilLine, Plus, RotateCcw, ScanEye, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { cn } from "@/lib/cn";
import { Banner, Button, Card, Input, Spinner, Tag } from "@/components/ui";
import { ConfirmModal } from "@/components/admin";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownContent } from "@/components/MarkdownContent";
import type { SitePageAdmin, SitePageCreate } from "@/lib/types";

type Locale = "vi" | "en";
type Draft = SitePageCreate;

const EMPTY_DRAFT: Draft = {
  slug: "",
  sort_order: 100,
  show_in_footer: true,
  title_vi: "",
  title_en: "",
  body_vi: "",
  body_en: "",
};

function toDraft(page: SitePageAdmin): Draft {
  const { slug, sort_order, show_in_footer, title_vi, title_en, body_vi, body_en } = page;
  return { slug, sort_order, show_in_footer, title_vi, title_en, body_vi, body_en };
}

function sameDraft(a: Draft, b: Draft) {
  return (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function AdminSitePagesPage() {
  const queryClient = useQueryClient();
  const apiErrorMessage = useApiErrorMessage();

  const pagesQuery = useQuery({ queryKey: ["admin", "site-pages"], queryFn: () => api.adminSitePages() });
  const pages = React.useMemo(() => pagesQuery.data?.items ?? [], [pagesQuery.data]);

  // null slug = đang tạo trang mới
  const [selected, setSelected] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [locale, setLocale] = React.useState<Locale>("vi");
  const [preview, setPreview] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");
  const [confirm, setConfirm] = React.useState<"reset" | "delete" | null>(null);

  const current = React.useMemo(
    () => (creating ? null : pages.find((p) => p.slug === selected) ?? null),
    [creating, pages, selected],
  );

  // Chọn trang đầu tiên khi tải xong; đồng bộ draft khi đổi trang / server trả bản mới.
  React.useEffect(() => {
    if (!creating && !selected && pages.length) setSelected(pages[0].slug);
  }, [creating, pages, selected]);
  React.useEffect(() => {
    if (current) setDraft(toDraft(current));
  }, [current]);

  const baseline = creating ? EMPTY_DRAFT : current ? toDraft(current) : EMPTY_DRAFT;
  const dirty = !sameDraft(draft, baseline);
  const slugValid = !creating || SLUG_RE.test(draft.slug);
  const canSave = dirty && slugValid && draft.title_vi.trim() !== "" && draft.body_vi.trim() !== "";

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const startCreate = () => {
    setCreating(true);
    setSelected(null);
    setDraft(EMPTY_DRAFT);
    setLocale("vi");
    setPreview(false);
    setMsg("");
    setErr("");
  };

  const pick = (slug: string) => {
    setCreating(false);
    setSelected(slug);
    setPreview(false);
    setMsg("");
    setErr("");
  };

  const refresh = async (next?: SitePageAdmin) => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "site-pages"] });
    if (next) {
      setCreating(false);
      setSelected(next.slug);
      setDraft(toDraft(next));
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const next = creating
        ? await api.adminCreateSitePage({ ...draft, slug: draft.slug.trim() })
        : await api.adminUpdateSitePage(draft.slug, {
            sort_order: draft.sort_order,
            show_in_footer: draft.show_in_footer,
            title_vi: draft.title_vi,
            title_en: draft.title_en,
            body_vi: draft.body_vi,
            body_en: draft.body_en,
          });
      await refresh(next);
      setMsg(creating ? "Đã tạo trang." : "Đã lưu.");
    } catch (e) {
      setErr(apiErrorMessage(e, "Lưu không thành công."));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!current) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const next = await api.adminResetSitePage(current.slug);
      await refresh(next);
      setMsg("Đã khôi phục nội dung mặc định.");
    } catch (e) {
      setErr(apiErrorMessage(e, "Khôi phục không thành công."));
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  const remove = async () => {
    if (!current) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      await api.adminDeleteSitePage(current.slug);
      setSelected(null);
      await refresh();
      setMsg("Đã xoá trang.");
    } catch (e) {
      setErr(apiErrorMessage(e, "Xoá không thành công."));
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  const bodyKey = locale === "vi" ? "body_vi" : "body_en";
  const titleKey = locale === "vi" ? "title_vi" : "title_en";

  if (pagesQuery.isLoading) {
    return <div className="grid h-[320px] place-items-center"><Spinner label="Đang tải" /></div>;
  }
  if (pagesQuery.isError) {
    return <Banner tone="bad">{apiErrorMessage(pagesQuery.error, "Không tải được danh sách trang.")}</Banner>;
  }

  return (
    <div className="animate-rise grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* Danh sách trang */}
      <Card className="p-0 self-start">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">Trang nội dung</p>
            <p className="mt-0.5 text-[12px] text-slate-500">Hiện ở cột Hỗ trợ trong footer</p>
          </div>
          <Button size="sm" variant="secondary" onClick={startCreate} disabled={saving}>
            <Plus size={14} /> Thêm
          </Button>
        </div>
        <ul className="border-t border-line">
          {pages.map((p) => {
            const active = !creating && p.slug === selected;
            return (
              <li key={p.slug}>
                <button
                  type="button"
                  onClick={() => pick(p.slug)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-slate-50",
                    active && "bg-iris-soft/60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-900">{p.title_vi}</p>
                    <p className="truncate font-mono text-[11px] text-slate-400">/legal/{p.slug}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 pt-0.5">
                    {p.customized && <Tag tone="iris">Đã sửa</Tag>}
                    {p.show_in_footer
                      ? <Eye size={13} className="text-slate-400" aria-label="Hiện ở footer" />
                      : <EyeOff size={13} className="text-slate-300" aria-label="Ẩn khỏi footer" />}
                  </div>
                </button>
              </li>
            );
          })}
          {creating && (
            <li className="bg-iris-soft/60 px-4 py-2.5 text-[13px] font-medium text-slate-900">Trang mới</li>
          )}
        </ul>
      </Card>

      {/* Trình soạn */}
      {(current || creating) ? (
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight text-fg">
                {creating ? "Tạo trang mới" : current?.title_vi}
              </h2>
              <p className="mt-0.5 max-w-2xl text-[12px] leading-snug text-muted">
                Nội dung viết bằng Markdown. Bản tiếng Anh để trống sẽ tự dùng bản tiếng Việt.
              </p>
            </div>
            {current && (
              <a
                href={`/vi/legal/${current.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12px] text-iris hover:underline"
              >
                Xem trang <ExternalLink size={12} />
              </a>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_auto]">
            <label className="block text-[12px] text-muted">
              Đường dẫn (slug)
              <Input
                value={draft.slug}
                disabled={!creating}
                onChange={(e) => set("slug", e.target.value.toLowerCase())}
                placeholder="vd: faq, lien-he"
                className={cn("mt-1 h-9 font-mono", !slugValid && "border-red-400")}
              />
              {creating && !slugValid && draft.slug && (
                <span className="mt-1 block text-[11px] text-red-600">Chỉ dùng a–z, 0–9 và dấu gạch ngang.</span>
              )}
            </label>
            <label className="block text-[12px] text-muted">
              Thứ tự
              <Input
                inputMode="numeric"
                value={String(draft.sort_order)}
                onChange={(e) => set("sort_order", Number(e.target.value.replace(/\D/g, "")) || 0)}
                className="mt-1 h-9 text-right font-mono"
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={draft.show_in_footer}
                onChange={(e) => set("show_in_footer", e.target.checked)}
                className="h-4 w-4 accent-iris"
              />
              Hiện ở footer
            </label>
          </div>

          <div className="mt-4 flex items-center gap-1" role="group" aria-label="Ngôn ngữ">
            {(["vi", "en"] as const).map((code) => (
              <Button
                key={code}
                size="sm"
                variant={locale === code ? "primary" : "secondary"}
                onClick={() => setLocale(code)}
              >
                {code === "vi" ? "Tiếng Việt" : "English"}
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-raised p-0.5" role="group" aria-label="Chế độ">
              {([
                { key: false, label: "Soạn thảo", Icon: PencilLine },
                { key: true, label: "Xem trước", Icon: ScanEye },
              ] as const).map(({ key, label, Icon }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={preview === key}
                  onClick={() => setPreview(key)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors",
                    preview === key ? "bg-surface text-iris-hi shadow-card" : "text-muted hover:text-fg",
                  )}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-3 block text-[12px] text-muted">
            Tiêu đề {locale === "vi" ? "(bắt buộc)" : "(tuỳ chọn)"}
            <Input
              value={draft[titleKey]}
              onChange={(e) => set(titleKey, e.target.value)}
              className="mt-1 h-9"
              maxLength={160}
            />
          </label>

          <div className="mt-3">
            {/* Editor giữ mounted khi xem trước (chỉ ẩn) để không mất vị trí
                con trỏ / undo; khung xem trước cuộn trong chính nó như editor. */}
            {preview && (
              <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-surface p-5">
                <h1 className="font-serif text-[24px] font-semibold tracking-tight">
                  {draft[titleKey] || draft.title_vi}
                </h1>
                <MarkdownContent className="mt-4">{draft[bodyKey] || draft.body_vi}</MarkdownContent>
              </div>
            )}
            <div className={preview ? "hidden" : undefined}>
              <MarkdownEditor
                value={draft[bodyKey]}
                onChange={(v) => set(bodyKey, v)}
                placeholder={locale === "vi" ? "## Tiêu đề mục\n\nNội dung…" : "Leave empty to reuse the Vietnamese copy"}
              />
            </div>
          </div>

          {err && <Banner tone="bad" className="mt-3">{err}</Banner>}
          {msg && !err && <Banner tone="good" className="mt-3">{msg}</Banner>}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button onClick={save} disabled={!canSave || saving}>
              {saving ? "Đang lưu…" : creating ? "Tạo trang" : "Lưu thay đổi"}
            </Button>
            {dirty && !creating && (
              <Button variant="ghost" onClick={() => current && setDraft(toDraft(current))} disabled={saving}>
                Bỏ thay đổi
              </Button>
            )}
            {creating && (
              <Button variant="ghost" onClick={() => { setCreating(false); if (pages[0]) setSelected(pages[0].slug); }} disabled={saving}>
                Huỷ
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {current?.is_system && (
                <Button variant="secondary" size="sm" onClick={() => setConfirm("reset")} disabled={saving || !current.customized}>
                  <RotateCcw size={14} /> Về mặc định
                </Button>
              )}
              {current && !current.is_system && (
                <Button variant="danger" size="sm" onClick={() => setConfirm("delete")} disabled={saving}>
                  <Trash2 size={14} /> Xoá trang
                </Button>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="grid place-items-center p-10 text-[13px] text-muted">Chưa có trang nào — bấm Thêm để tạo.</Card>
      )}

      <ConfirmModal
        isOpen={confirm === "reset"}
        onClose={() => setConfirm(null)}
        onConfirm={reset}
        title="Khôi phục nội dung mặc định?"
        description="Toàn bộ nội dung đã sửa (cả tiếng Việt và tiếng Anh) sẽ bị thay bằng bản mặc định của hệ thống."
        confirmText="Khôi phục"
        isLoading={saving}
      />
      <ConfirmModal
        isOpen={confirm === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={remove}
        title="Xoá trang này?"
        description={`Đường dẫn /legal/${current?.slug ?? ""} sẽ không còn truy cập được và bị gỡ khỏi footer.`}
        confirmText="Xoá"
        variant="danger"
        isLoading={saving}
      />
    </div>
  );
}
