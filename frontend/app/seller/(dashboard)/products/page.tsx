"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, vnd } from "@/lib/api";
import type { SellerProduct } from "@/lib/types";
import { Button, Card, Spinner, Tag, Tooltip } from "@/components/ui";
import { Edit2, Eye, Package, Plus, Trash } from "@/components/Icons";

const STATUS_MAP: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  active: { label: "Đang bán", tone: "good" },
  draft: { label: "Nháp", tone: "neutral" },
  paused: { label: "Tạm dừng", tone: "warn" },
  suspended: { label: "Bị khoá", tone: "bad" },
};

export default function SellerProducts() {
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.sellerProducts().then(setProducts).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (id: number) => {
    if (!confirm("Tạm dừng sản phẩm này?")) return;
    await api.deleteProduct(id);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[16px] font-semibold">Sản phẩm của bạn</h2>
          <p className="text-[13px] text-muted">{products.length} sản phẩm</p>
        </div>
        <Link href="/seller/products/new">
          <Button><Plus size={15} /> Tạo mới</Button>
        </Link>
      </div>

      {products.length === 0 ? (
        <Card className="p-8 text-center">
          <Package size={40} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] text-muted mb-4">Bạn chưa có sản phẩm nào</p>
          <Link href="/seller/products/new"><Button><Plus size={15} /> Tạo sản phẩm đầu tiên</Button></Link>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[12px] text-faint border-b border-line">
                <th className="font-medium px-5 py-3">Sản phẩm</th>
                <th className="font-medium px-3 py-3 hidden sm:table-cell">Danh mục</th>
                <th className="font-medium px-3 py-3">Trạng thái</th>
                <th className="font-medium px-3 py-3 hidden md:table-cell">Biến thể</th>
                <th className="font-medium px-3 py-3 hidden md:table-cell">Tồn kho</th>
                <th className="font-medium px-5 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const st = STATUS_MAP[p.status] ?? { label: p.status, tone: "neutral" as const };
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-raised transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg bg-raised border border-line font-serif text-[13px] font-semibold text-iris">
                          {p.title.slice(0, 2).toUpperCase()}
                        </span>
                        <Tooltip text={p.title} position="bottom">
                          <div className="min-w-0 cursor-default">
                            <div className="font-medium text-[13.5px] truncate max-w-[240px]">{p.title}</div>
                            <div className="text-[11px] text-faint">{p.service_type ?? "other"}</div>
                          </div>
                        </Tooltip>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-muted hidden sm:table-cell">{p.category_name ?? "—"}</td>
                    <td className="px-3 py-3"><Tag tone={st.tone}>{st.label}</Tag></td>
                    <td className="px-3 py-3 text-[13px] text-muted hidden md:table-cell">{p.variant_count}</td>
                    <td className="px-3 py-3 text-[13px] text-muted hidden md:table-cell">{p.total_stock}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Link href={`/products/${p.id}`} title="Xem trang mua">
                          <Button size="sm" variant="ghost"><Eye size={14} /></Button>
                        </Link>
                        <Link href={`/seller/products/${p.id}`} title="Chỉnh sửa">
                          <Button size="sm" variant="ghost"><Edit2 size={14} /></Button>
                        </Link>
                        {p.status === "active" && (
                          <Button size="sm" variant="ghost" className="text-bad hover:text-bad" onClick={() => remove(p.id)} title="Tạm dừng"><Trash size={14} /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
