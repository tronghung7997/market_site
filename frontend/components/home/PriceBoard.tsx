"use client";

/** Bảng giá trực tiếp trong hero — 5 sản phẩm đầu, mỗi dòng là link. */

import Link from "next/link";
import { vnd } from "@/lib/api";
import type { Product } from "@/lib/types";
import { Card, Monogram, Spinner } from "@/components/ui";

export function PriceBoard({ products, catName, stock, minPrice, loading }: {
  products: Product[]; catName: (id: number) => string;
  stock: (p: Product) => number; minPrice: (p: Product) => number; loading: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-raised/60">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-bad/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-good/60" />
        </span>
        <span className="text-[12.5px] font-medium text-muted ml-1">Bảng giá trực tiếp</span>
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-good"><span className="h-1.5 w-1.5 rounded-full bg-good animate-pulse" /> trực tuyến</span>
      </div>
      <div className="divide-y divide-line">
        {loading && <div className="px-4 py-10"><Spinner /></div>}
        {!loading && products.slice(0, 5).map((p) => (
          <Link key={p.id} href={`/products/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised transition-colors">
            <Monogram text={p.title} className="h-8 w-8 rounded-md text-[12px]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium truncate">{p.title}</span>
              <span className="block text-[11.5px] text-faint">{catName(p.category_id)}</span>
            </span>
            {stock(p) > 0 ? (
              <span className="text-[11px] text-good font-medium">● {stock(p)}</span>
            ) : (
              <span className="text-[11px] text-warn">Theo yêu cầu</span>
            )}
            <span className="font-mono text-[13px] font-semibold tabular w-[92px] text-right">{vnd(minPrice(p))}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
