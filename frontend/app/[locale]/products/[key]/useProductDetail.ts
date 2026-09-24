/** Data của trang sản phẩm — một hook gói trọn 3 lần fetch: chi tiết sản phẩm,
 *  pricing strategy (quyết định form đặt hàng nào), và sản phẩm liên quan.
 *  Interface: chỉ dữ liệu ra, không lộ useEffect nào cho page. */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { Product, ProductDetail } from "@/lib/types";
import type { ProductPageCatalog } from "@/features/catalog";
import { productKeyFromParam } from "@/lib/routes";

/** Does the server-loaded product belong to this route param (key, or legacy id)? */
function matchesRef(product: ProductDetail, ref: string): boolean {
  const key = productKeyFromParam(ref);
  return key ? product.public_key === key : String(product.id) === ref;
}

export interface ProductDetailState {
  product: ProductDetail | null;
  related: Product[];
  /** null = đang tải; "fixed" = flow variant; khác = DynamicOrderForm. */
  pricingStrategy: string | null;
  loading: boolean;
  error: string | null;
  /** Sản phẩm đang ẩn khỏi chợ, chủ sản phẩm / admin đang xem bản xem trước. */
  preview: "admin" | "seller" | null;
}

/** Ai được xem trước sản phẩm đang ẩn: admin trước, rồi seller (backend kiểm chủ). */
function previewRole(roles: string[] | undefined): "admin" | "seller" | null {
  if (roles?.includes("admin")) return "admin";
  if (roles?.includes("seller")) return "seller";
  return null;
}

export function useProductDetail(ref: string, initial?: ProductPageCatalog | null): ProductDetailState {
  const t = useTranslations("products");
  const apiErrorMessage = useApiErrorMessage();
  const [product, setProduct] = useState<ProductDetail | null>(initial?.product ?? null);
  const [related, setRelated] = useState<Product[]>(initial?.related ?? []);
  const [pricingStrategy, setPricingStrategy] = useState<string | null>(initial?.pricingStrategy ?? null);
  const [loading, setLoading] = useState(!initial?.product);
  const [error, setError] = useState<string | null>(initial?.error && !initial.product ? initial.error : null);
  const [preview, setPreview] = useState<"admin" | "seller" | null>(null);
  const { account, loading: authLoading } = useAuth();
  const role = previewRole(account?.roles);

  useEffect(() => {
    if (initial?.product && matchesRef(initial.product, ref)) {
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
        let p: ProductDetail;
        try {
          p = await api.product(ref);
          setPreview(null);
        } catch (publicError) {
          // Khách thấy 404; chủ sản phẩm / admin được xem bản xem trước.
          // Phiên đăng nhập chưa tải xong thì chờ — effect chạy lại khi xong.
          if (!role && authLoading) return;
          if (!role) throw publicError;
          p = await api.productPreview(ref, role).catch(() => { throw publicError; });
          setPreview(role);
        }
        setProduct(p);
        setError(null);
        try {
          const opts = await api.pricingOptions(p.id);
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
        setLoading(false);
      } catch (error) {
        setError(apiErrorMessage(error, t("notFound")));
        setLoading(false);
      }
    })();
  }, [apiErrorMessage, ref, initial, t, role, authLoading]);

  return { product, related, pricingStrategy, loading, error, preview };
}
