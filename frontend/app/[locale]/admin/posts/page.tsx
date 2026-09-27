"use client";

/** Blog admin: guides and marketplace news, written in Vietnamese (English
 *  optional — the storefront falls back to Vietnamese), drafted or published. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { headingSlug } from "@/lib/heading-slug";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import type { PostAdmin, PostCategory, PostLocaleCopy, PostWrite } from "@/lib/types";
import { Button, Card, Input, Select, Spinner, Tag, Textarea } from "@/components/ui";
import { ConfirmModal } from "@/components/admin";
import { ImageUploader, type UploaderImage } from "@/components/media/ImageUploader";
import { MarkdownEditor } from "@/components/MarkdownEditor";

const CATEGORY_LABEL: Record<PostCategory, string> = { guide: "Hướng dẫn", news: "Tin sàn" };
const EMPTY_COPY: PostLocaleCopy = { title: "", excerpt: "", body: "" };

type Draft = { id: number | null; slug: string; category: PostCategory; vi: PostLocaleCopy; en: PostLocaleCopy; cover: UploaderImage[]; published: boolean };

function toDraft(post: PostAdmin | null): Draft {
  if (!post) return { id: null, slug: "", category: "guide", vi: { ...EMPTY_COPY }, en: { ...EMPTY_COPY }, cover: [], published: false };
  return {
    id: post.id, slug: post.slug, category: post.category, vi: post.vi, en: post.en, published: post.status === "published",
    cover: post.cover ? [{ id: post.cover.id, url: post.cover.url, thumb_url: post.cover.thumb_url ?? post.cover.url, w: post.cover.w, h: post.cover.h }] : [],
  };
}

export default function AdminPostsPage() {
  const client = useQueryClient();
  const apiErrorMessage = useApiErrorMessage();
  const posts = useQuery({ queryKey: ["admin-posts"], queryFn: () => api.adminPosts() });
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [deleting, setDeleting] = React.useState<PostAdmin | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteAdminPost(id),
    onSuccess: () => { setDeleting(null); client.invalidateQueries({ queryKey: ["admin-posts"] }); },
  });

  if (draft) {
    return <PostEditor initial={draft} onDone={() => { setDraft(null); client.invalidateQueries({ queryKey: ["admin-posts"] }); }} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">Bài viết</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">Hướng dẫn và tin sàn hiện ở <Link href="/blog" className="underline">/blog</Link>. Bản tiếng Anh để trống thì khách EN thấy bản Việt.</p>
        </div>
        <Button onClick={() => setDraft(toDraft(null))}>Viết bài mới</Button>
      </div>
      <Card className="overflow-hidden p-0">
        {posts.isPending ? (
          <div className="grid place-items-center py-16"><Spinner /></div>
        ) : posts.isError ? (
          <p className="p-5 text-[13px] text-red-600">{apiErrorMessage(posts.error, "Không tải được bài viết")}</p>
        ) : (posts.data ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-slate-500">Chưa có bài viết nào.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-5 py-2.5 font-medium">Tiêu đề</th>
                <th className="px-5 py-2.5 font-medium">Chuyên mục</th>
                <th className="px-5 py-2.5 font-medium">Trạng thái</th>
                <th className="px-5 py-2.5 font-medium">Cập nhật</th>
                <th className="w-40 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {posts.data!.map((post) => (
                <tr key={post.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-700">{post.vi.title || "(chưa có tiêu đề)"}</div>
                    <div className="text-[12px] text-slate-400">/blog/{post.slug}</div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{CATEGORY_LABEL[post.category]}</td>
                  <td className="px-5 py-3">
                    <Tag tone={post.status === "published" ? "good" : "neutral"}>{post.status === "published" ? "Đã đăng" : "Nháp"}</Tag>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{formatDateTime(post.updated_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setDraft(toDraft(post))}>Sửa</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(post)}>Xoá</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <ConfirmModal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Xoá bài viết"
        description={deleting ? `Xoá hẳn “${deleting.vi.title || deleting.slug}”. Đường dẫn sẽ không còn mở được.` : ""}
        confirmText="Xoá"
        variant="danger"
        isLoading={remove.isPending}
      />
    </div>
  );
}

function PostEditor({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const apiErrorMessage = useApiErrorMessage();
  const [draft, setDraft] = React.useState(initial);
  const [locale, setLocale] = React.useState<"vi" | "en">("vi");
  const [slugTouched, setSlugTouched] = React.useState(initial.id !== null);
  const save = useMutation({
    mutationFn: (publish: boolean) => {
      const body: PostWrite = {
        slug: draft.slug, category: draft.category, vi: draft.vi, en: draft.en,
        cover_image_id: draft.cover[0]?.id ?? null, publish,
      };
      return draft.id === null ? api.createAdminPost(body) : api.updateAdminPost(draft.id, body);
    },
    onSuccess: onDone,
  });
  const copy = draft[locale];
  const setCopy = (field: keyof PostLocaleCopy, value: string) => setDraft((d) => {
    const next = { ...d, [locale]: { ...d[locale], [field]: value } };
    if (field === "title" && locale === "vi" && !slugTouched) next.slug = headingSlug(value).replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
    return next;
  });
  const canPublish = draft.vi.title.trim().length > 0 && draft.vi.body.trim().length > 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[18px] font-semibold text-slate-900">{draft.id === null ? "Viết bài mới" : "Sửa bài viết"}</h1>
        <Button variant="ghost" onClick={onDone}>Quay lại danh sách</Button>
      </div>
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
          <label className="block text-[12.5px] text-slate-600">
            Đường dẫn (/blog/…)
            <Input value={draft.slug} maxLength={80} onChange={(e) => { setSlugTouched(true); setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase() })); }} className="mt-1 font-mono" />
          </label>
          <label className="block text-[12.5px] text-slate-600">
            Chuyên mục
            <Select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as PostCategory }))} className="mt-1">
              <option value="guide">{CATEGORY_LABEL.guide}</option>
              <option value="news">{CATEGORY_LABEL.news}</option>
            </Select>
          </label>
        </div>
        <ImageUploader
          purpose="post_cover"
          value={draft.cover}
          onChange={(cover) => setDraft((d) => ({ ...d, cover }))}
          label="Ảnh bìa"
          hint="Tỉ lệ 1.91:1, dùng làm ảnh xem trước khi chia sẻ link."
          layout="banner"
        />
        <div role="tablist" aria-label="Ngôn ngữ" className="flex w-fit rounded-lg border border-slate-200 p-0.5">
          {(["vi", "en"] as const).map((loc) => (
            <button
              key={loc}
              type="button"
              role="tab"
              aria-selected={locale === loc}
              onClick={() => setLocale(loc)}
              className={cn("h-7 rounded-md px-3 text-[12px] font-semibold uppercase", locale === loc ? "bg-slate-100 text-slate-900" : "text-slate-500")}
            >
              {loc}
            </button>
          ))}
        </div>
        <label className="block text-[12.5px] text-slate-600">
          Tiêu đề
          <Input value={copy.title} maxLength={200} onChange={(e) => setCopy("title", e.target.value)} className="mt-1" />
        </label>
        <label className="block text-[12.5px] text-slate-600">
          Tóm tắt (hiện ở danh sách và mô tả SEO)
          <Textarea value={copy.excerpt} maxLength={400} rows={2} onChange={(e) => setCopy("excerpt", e.target.value)} className="mt-1" />
        </label>
        <div className="text-[12.5px] text-slate-600">
          Nội dung (markdown)
          <div className="mt-1"><MarkdownEditor key={locale} value={copy.body} onChange={(value) => setCopy("body", value)} /></div>
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {save.isError && <span className="mr-auto text-[13px] text-red-600">{apiErrorMessage(save.error, "Không lưu được bài viết")}</span>}
        <Button variant="secondary" loading={save.isPending && !save.variables} disabled={!draft.slug} onClick={() => save.mutate(false)}>
          {draft.published ? "Chuyển về nháp" : "Lưu nháp"}
        </Button>
        <Button loading={save.isPending && !!save.variables} disabled={!canPublish} onClick={() => save.mutate(true)}>
          {draft.published ? "Lưu và giữ đăng" : "Đăng bài"}
        </Button>
      </div>
    </div>
  );
}
