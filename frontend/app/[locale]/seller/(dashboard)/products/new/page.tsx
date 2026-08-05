"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Category } from "@/lib/types";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { ProductPreviewCard } from "@/components/seller/ProductPreviewCard";

const SERVICE_TYPES = [
  { value: "account", label: "Tài khoản" },
  { value: "proxy", label: "Proxy" },
  { value: "token", label: "Token" },
  { value: "endpoint", label: "Endpoint" },
  { value: "cloud", label: "Cloud" },
  { value: "payment", label: "Thanh toán" },
  { value: "takedown", label: "Takedown" },
  { value: "other", label: "Khác" },
];

// Loại nào seller tự bán bằng biến thể (giá cố định), loại nào thường được vận
// hành qua nhà cung cấp do admin cấu hình — nói trước để seller không mất công
// tạo biến thể cho một sản phẩm sẽ không dùng tới nó.
const SELF_SERVE_HINT = "Bạn tự thêm biến thể + giá + kho hàng ngay sau khi tạo.";
const ADMIN_SETUP_HINT =
  "Loại này thường được vận hành qua nhà cung cấp do quản trị viên cấu hình, không dùng Biến thể. " +
  "Sau khi tạo, vào tab \"Vận hành\" để xem sản phẩm đã sẵn sàng bán chưa.";
const SERVICE_TYPE_HINTS: Record<string, string> = {
  account: SELF_SERVE_HINT,
  proxy: ADMIN_SETUP_HINT,
  token: ADMIN_SETUP_HINT,
  endpoint: ADMIN_SETUP_HINT,
  cloud: ADMIN_SETUP_HINT,
  payment: ADMIN_SETUP_HINT,
  takedown: ADMIN_SETUP_HINT,
  other: SELF_SERVE_HINT,
};

function flatten(cats: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (l: Category[]) => l.forEach((c) => { out.push(c); walk(c.children ?? []); });
  walk(cats);
  return out;
}

// Một chỗ parse duy nhất cho cả preview lẫn submit — preview mà parse kiểu
// khác submit là preview nói dối (dòng specs thiếu ":" hiện ở preview nhưng
// biến mất sau khi lưu, hoặc ngược lại).
function parseFeatures(raw: string): string[] {
  return raw.split("\n").map((f) => f.trim()).filter(Boolean);
}

function parseSpecs(raw: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) out.push({ key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
  }
  return out;
}

export default function NewProduct() {
  const router = useRouter();
  const [cats, setCats] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<number>(0);
  const [serviceType, setServiceType] = useState("account");
  const [description, setDescription] = useState("");
  // Preview bên phải parse lại toàn bộ markdown mỗi lần description đổi —
  // useDeferredValue để React ưu tiên phần gõ, khối Preview được phép "theo
  // sau" vài khung hình khi gõ nhanh (giống trang sửa sản phẩm).
  const deferredDescription = useDeferredValue(description);
  const [highlightText, setHighlightText] = useState("");
  const [escrowDays, setEscrowDays] = useState(3);
  const [features, setFeatures] = useState("");
  const [warrantyText, setWarrantyText] = useState("");
  const [specs, setSpecs] = useState("");

  useEffect(() => {
    api.categories().then((c) => {
      setCats(c);
      const flat = flatten(c);
      if (flat.length > 0) setCategoryId(flat[0].id);
    });
  }, []);

  const submit = async () => {
    if (!title.trim() || !categoryId) return;
    setSaving(true); setError(null);
    try {
      const featureList = parseFeatures(features);
      const specsEntries = parseSpecs(specs);
      const specsObj = specsEntries.length > 0
        ? Object.fromEntries(specsEntries.map((s) => [s.key, s.value]))
        : undefined;
      const product = await api.createProduct({
        title: title.trim(),
        category_id: categoryId,
        service_type: serviceType,
        description: description.trim() || null,
        highlight_text: highlightText.trim() || null,
        escrow_days: escrowDays,
        features: featureList.length > 0 ? featureList : null,
        warranty_text: warrantyText.trim() || null,
        specs: specsObj ?? null,
        status: "active",
      });
      router.push(`/seller/products/${product.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tạo sản phẩm");
    } finally {
      setSaving(false);
    }
  };

  const flatCats = flatten(cats);

  return (
    <div className="space-y-5">
      <h2 className="text-[16px] font-semibold">Tạo sản phẩm mới</h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px] items-start">
        <Card className="min-w-0 p-6 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Tên sản phẩm *">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Twitter cổ 2020+ — Trust cao" />
            </Field>
            <Field label="Danh mục *">
              <Select value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
                {flatCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Loại dịch vụ" hint={SERVICE_TYPE_HINTS[serviceType]}>
              <Select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                {SERVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Thời gian ký quỹ (ngày)">
              <Input type="number" min={1} value={escrowDays} onChange={(e) => setEscrowDays(Number(e.target.value) || 3)} />
            </Field>
          </div>

          <Field label="Dòng nổi bật" hint="Hiển thị trên ảnh sản phẩm">
            <Input value={highlightText} onChange={(e) => setHighlightText(e.target.value)} placeholder="VD: IP sạch — Giống người thật" />
          </Field>

          <Field label="Mô tả" hint="Hỗ trợ markdown — xem kết quả ở khung Xem trước">
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder="VD: **Tài khoản Facebook uy tín**, tạo hơn 2 tháng tuổi. Đã xác minh email, không dính báo cáo vi phạm."
            />
          </Field>

          <Field label="Tính năng" hint="Mỗi dòng là một tính năng">
            <Textarea rows={4} value={features} onChange={(e) => setFeatures(e.target.value)} placeholder="Tài khoản cổ từ 2020&#10;Đã xác minh email&#10;Trust score cao" />
          </Field>

          <Field label="Thông số kỹ thuật" hint="key: value, mỗi dòng một thông số">
            <Textarea rows={4} value={specs} onChange={(e) => setSpecs(e.target.value)} placeholder="format: ID | PASS | MAIL&#10;platform: Twitter / X&#10;country: US, UK, VN" />
          </Field>

          <Field label="Chính sách bảo hành">
            <Textarea rows={3} value={warrantyText} onChange={(e) => setWarrantyText(e.target.value)} placeholder="Bảo hành 24h nếu tài khoản lỗi..." />
          </Field>

          {error && <p className="text-bad text-[13px]">{error}</p>}

          <div className="flex items-center gap-3 pt-2">
            <Button size="lg" disabled={!title.trim() || !categoryId || saving} onClick={submit}>
              {saving ? "Đang tạo…" : "Tạo sản phẩm"}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => router.push("/seller/products")}>Huỷ</Button>
          </div>
        </Card>

        <div className="min-w-0 lg:sticky lg:top-6">
          <ProductPreviewCard
            title={title}
            categoryName={flatCats.find((c) => c.id === categoryId)?.name}
            serviceType={serviceType}
            status="active"
            escrowDays={escrowDays}
            highlightText={highlightText}
            description={deferredDescription}
            features={parseFeatures(features)}
            specs={parseSpecs(specs)}
            warrantyText={warrantyText}
            variants={[]}
          />
        </div>
      </div>
    </div>
  );
}
