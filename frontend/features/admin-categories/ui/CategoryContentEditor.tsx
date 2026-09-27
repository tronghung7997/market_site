"use client";

/** Admin editor for the buyer-facing copy of a category page: a short
 *  description under the title, a markdown guide and a FAQ, per language.
 *  Saved on its own (not through the panel's save bar) because it is a
 *  separate request and can be long. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { faqToText, parseFaqBlocks } from "@/lib/faq-text";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { CategoryContentAdmin, ProductLocale } from "@/lib/types";
import { Button, Skeleton, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";

const LOCALES: ProductLocale[] = ["vi", "en"];
const DESCRIPTION_MAX = 300;
const GUIDE_MAX = 8000;
const FAQ_MAX = 12;

type Draft = Record<ProductLocale, { description: string; guide: string; faq: string }>;

function toDraft(content: CategoryContentAdmin): Draft {
  return Object.fromEntries(LOCALES.map((loc) => [loc, {
    description: content[loc]?.description ?? "",
    guide: content[loc]?.guide ?? "",
    faq: faqToText(content[loc]?.faq ?? []),
  }])) as Draft;
}

export function CategoryContentEditor({ categoryId }: { categoryId: number }) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const queryKey = ["admin-category-content", categoryId] as const;
  const content = useQuery({ queryKey, queryFn: () => api.adminCategoryContent(categoryId) });
  const [locale, setLocale] = React.useState<ProductLocale>("vi");
  const [draft, setDraft] = React.useState<Draft | null>(null);

  React.useEffect(() => {
    if (content.data) setDraft(toDraft(content.data));
  }, [content.data]);

  const baseline = content.data ? toDraft(content.data) : null;
  const dirty = !!draft && !!baseline && JSON.stringify(draft) !== JSON.stringify(baseline);
  const faqCount = draft ? parseFaqBlocks(draft[locale].faq).length : 0;
  const tooMany = draft ? LOCALES.some((loc) => parseFaqBlocks(draft[loc].faq).length > FAQ_MAX) : false;

  const save = useMutation({
    mutationFn: () => api.updateCategory(categoryId, {
      content: Object.fromEntries(LOCALES.map((loc) => [loc, {
        description: draft![loc].description.trim() || null,
        guide: draft![loc].guide.trim() || null,
        faq: parseFaqBlocks(draft![loc].faq),
      }])),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Đã lưu nội dung trang danh mục.");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Không lưu được nội dung.")),
  });

  const set = (field: keyof Draft[ProductLocale], value: string) =>
    setDraft((prev) => prev && { ...prev, [locale]: { ...prev[locale], [field]: value } });

  return (
    <section className="rounded-card border border-line bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-line bg-raised/40 px-4 py-2.5">
        <div>
          <h3 className="text-[13px] font-semibold text-fg">Nội dung trang danh mục</h3>
          <p className="mt-0.5 text-[12px] text-muted">Mô tả dưới tiêu đề, bài hướng dẫn và câu hỏi thường gặp. Bản EN còn trống thì khách EN thấy bản VI.</p>
        </div>
        <div role="tablist" aria-label="Ngôn ngữ" className="flex shrink-0 rounded-lg border border-line bg-surface p-0.5">
          {LOCALES.map((loc) => (
            <button
              key={loc}
              type="button"
              role="tab"
              aria-selected={locale === loc}
              onClick={() => setLocale(loc)}
              className={cn("h-7 rounded-md px-2.5 text-[12px] font-semibold uppercase", locale === loc ? "bg-raised text-fg" : "text-muted hover:text-fg")}
            >
              {loc}
            </button>
          ))}
        </div>
      </header>
      <div className="space-y-3 p-4">
        {content.isError ? (
          <div className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="text-bad">{apiErrorMessage(content.error, "Không tải được nội dung.")}</span>
            <Button size="sm" variant="secondary" onClick={() => content.refetch()}>Thử lại</Button>
          </div>
        ) : !draft ? (
          <div className="space-y-2"><Skeleton className="h-9" /><Skeleton className="h-24" /><Skeleton className="h-20" /></div>
        ) : (
          <>
            <label className="block">
              <span className="text-[12.5px] font-medium text-muted">Mô tả ngắn</span>
              <Textarea rows={2} maxLength={DESCRIPTION_MAX} value={draft[locale].description} onChange={(e) => set("description", e.target.value)} placeholder="1–2 câu: danh mục gồm gì, dùng cho việc gì." />
              <span className="mt-1 block text-[11.5px] text-faint">{draft[locale].description.length}/{DESCRIPTION_MAX}</span>
            </label>
            <label className="block">
              <span className="text-[12.5px] font-medium text-muted">Hướng dẫn (markdown)</span>
              <Textarea rows={6} maxLength={GUIDE_MAX} value={draft[locale].guide} onChange={(e) => set("guide", e.target.value)} placeholder={"## Nên chọn gói nào?\nViết cho người mua mới…"} className="font-mono text-xs" />
            </label>
            <label className="block">
              <span className="text-[12.5px] font-medium text-muted">Câu hỏi thường gặp</span>
              <Textarea rows={5} value={draft[locale].faq} onChange={(e) => set("faq", e.target.value)} placeholder={"Câu hỏi ở dòng đầu?\nCâu trả lời ở dòng dưới.\n\nCâu hỏi tiếp theo?\nCâu trả lời."} />
              <span className={cn("mt-1 block text-[11.5px]", faqCount > FAQ_MAX ? "text-bad" : "text-faint")}>
                {faqCount}/{FAQ_MAX} câu · cách nhau một dòng trống
              </span>
            </label>
            <div className="flex items-center justify-end gap-2">
              {dirty && <Button size="sm" variant="ghost" onClick={() => baseline && setDraft(baseline)} disabled={save.isPending}>Hoàn tác</Button>}
              <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || tooMany} loading={save.isPending}>Lưu nội dung</Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
