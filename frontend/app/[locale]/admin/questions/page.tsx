"use client";

/** Moderation of buyer-asked product questions. An admin hide takes a
 *  question off the storefront and the seller cannot bring it back. */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { formatDateTime } from "@/lib/utils";
import type { QuestionStatus, SellerQuestion } from "@/lib/types";
import { Button, Card, Pagination, Spinner, Tag } from "@/components/ui";

const FILTERS: { key: "all" | QuestionStatus; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "pending", label: "Chưa trả lời" },
  { key: "answered", label: "Đang hiển thị" },
  { key: "hidden", label: "Đã ẩn" },
];
const STATUS: Record<QuestionStatus, { label: string; tone: "warn" | "good" | "neutral" }> = {
  pending: { label: "Chưa trả lời", tone: "warn" },
  answered: { label: "Đang hiển thị", tone: "good" },
  hidden: { label: "Đã ẩn", tone: "neutral" },
};

export default function AdminQuestionsPage() {
  const apiErrorMessage = useApiErrorMessage();
  const client = useQueryClient();
  const [filter, setFilter] = React.useState<"all" | QuestionStatus>("all");
  const [page, setPage] = React.useState(1);
  const list = useQuery({
    queryKey: ["admin-questions", filter, page],
    queryFn: () => api.adminQuestions(filter, page),
    placeholderData: (previous) => previous,
  });
  const toggle = useMutation({
    mutationFn: (q: SellerQuestion) => api.setAdminQuestionVisibility(q.id, q.status !== "hidden"),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-questions"] }),
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[18px] font-semibold text-slate-900">Hỏi đáp sản phẩm</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Câu hỏi của khách chỉ hiện công khai sau khi shop trả lời. Ẩn ở đây thì shop không mở lại được.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? "primary" : "secondary"} onClick={() => { setFilter(f.key); setPage(1); }}>
            {f.label}
          </Button>
        ))}
      </div>
      {toggle.isError && <p className="text-[13px] text-red-600">{apiErrorMessage(toggle.error, "Không đổi được trạng thái")}</p>}
      <Card className="overflow-hidden p-0">
        {list.isPending ? (
          <div className="grid place-items-center py-16"><Spinner /></div>
        ) : list.isError ? (
          <p className="p-5 text-[13px] text-red-600">{apiErrorMessage(list.error, "Không tải được danh sách")}</p>
        ) : !data || data.items.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-slate-500">Không có câu hỏi nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Sản phẩm</th>
                  <th className="px-5 py-2.5 font-medium">Câu hỏi · trả lời</th>
                  <th className="px-5 py-2.5 font-medium">Trạng thái</th>
                  <th className="w-32 px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((q) => (
                  <tr key={q.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="max-w-[220px] px-5 py-3">
                      <Link href={q.product_path} className="font-medium text-slate-700 hover:underline">{q.product_title}</Link>
                      <div className="mt-0.5 text-[12px] text-slate-400">{q.asker_label} · {formatDateTime(q.created_at)}</div>
                    </td>
                    <td className="max-w-[420px] px-5 py-3">
                      <div className="whitespace-pre-line text-slate-700">{q.question}</div>
                      {q.answer && <div className="mt-1 whitespace-pre-line text-[12px] text-slate-500">Shop: {q.answer}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <Tag tone={STATUS[q.status].tone}>{STATUS[q.status].label}</Tag>
                      {q.hidden_by && <div className="mt-1 text-[12px] text-slate-400">Ẩn bởi {q.hidden_by === "admin" ? "admin" : "shop"}</div>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" variant="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate(q)}>
                        {q.status === "hidden" ? "Hiện lại" : "Ẩn"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && pages > 1 && <div className="flex justify-end"><Pagination page={page} totalPages={pages} onChange={setPage} /></div>}
    </div>
  );
}
