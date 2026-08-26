/** Data của trang sản phẩm — một hook gói trọn 3 lần fetch: chi tiết sản phẩm,
 *  pricing strategy (quyết định form đặt hàng nào), và sản phẩm liên quan.
 *  Interface: chỉ dữ liệu ra, không lộ useEffect nào cho page. */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Product, ProductDetail } from "@/lib/types";
import type { ProductPageCatalog } from "@/features/catalog";

export interface ProductDetailState {
  product: ProductDetail | null;
  related: Product[];
  /** null = đang tải; "fixed" = flow variant; khác = DynamicOrderForm. */
  pricingStrategy: string | null;
  loading: boolean;
  error: string | null;
}

export function useProductDetail(id: number, initial?: ProductPageCatalog | null): ProductDetailState {
  const [product, setProduct] = useState<ProductDetail | null>(initial?.product ?? null);
  const [related, setRelated] = useState<Product[]>(initial?.related ?? []);
  const [pricingStrategy, setPricingStrategy] = useState<string | null>(initial?.pricingStrategy ?? null);
  const [loading, setLoading] = useState(!initial?.product);
  const [error, setError] = useState<string | null>(initial?.error && !initial.product ? initial.error : null);

  useEffect(() => {
    if (initial?.product && initial.product.id === id) {
      setProduct(initial.product);
      setRelated(initial.related);
      setPricingStrategy(initial.pricingStrategy);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const p = await api.product(id);
        setProduct(p);
        try {
          const opts = await api.pricingOptions(id);
          setPricingStrategy(opts.strategy);
        } catch {
          setPricingStrategy("fixed"); // fallback to fixed/variant flow
        }
        if (p.category_id) {
          try {
            // Chỉ cần 3 tile gợi ý — lấy 1 trang nhỏ nhất đủ lọc trùng, đừng
            // kéo cả danh mục về (1000 sản phẩm chung danh mục = payload phí).
            const page1 = await api.products({ categoryId: p.category_id, page: 1, perPage: 24 });
            const seen = new Set<string>();
            setRelated(page1.items.filter((r) => {
              if (r.id === p.id) return false;
              // Trùng tên với sản phẩm đang xem → buyer tưởng trang tự lặp lại chính nó.
              if (r.title === p.title) return false;
              if (r.title.length < 3) return false;
              if (seen.has(r.title)) return false;
              seen.add(r.title);
              return true;
            }).slice(0, 3));
          } catch { /* ignore */ }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tìm thấy");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, initial]);

  return { product, related, pricingStrategy, loading, error };
}
