"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/query-keys";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { CategoryAdminRow, CategoryCreateInput, CategoryUpdateInput, FeeConfigAdmin } from "@/lib/types";
import { Button, Input, Select, Spinner, Switch, Tag } from "@/components/ui";
import { SlidePanel } from "@/components/admin";
import { useToast } from "@/components/toast";
import { AlertTriangle, ChevronRight, ExternalLink } from "@/components/Icons";
import { categoryCoverId, CoverPicker, ProductCover } from "@/features/product-covers";
import { descendantIds, pathTo, slugFromName } from "../model";

export type PanelMode = { kind: "create"; parentId: number | null } | { kind: "edit"; id: number };

type Form = {
  name: string;
  nameEn: string;
  slug: string;
  parentId: string;        // "" = root
  icon: string;            // "" = guess from the name
  isActive: boolean;
  commission: string;      // "" = inherit
  feeOverride: string;     // "" = platform default
  escrowOverride: string;  // "" = global floor
};

const percentOk = (v: string) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100);
const daysOk = (v: string) => v.trim() === "" || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 90);
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function initialForm(row: CategoryAdminRow | null, parentId: number | null, fees: FeeConfigAdmin | undefined): Form {
  if (!row) return { name: "", nameEn: "", slug: "", parentId: parentId == null ? "" : String(parentId), icon: "", isActive: true, commission: "", feeOverride: "", escrowOverride: "" };
  const fee = fees?.category_fee_percent[String(row.id)];
  const escrow = fees?.category_escrow_min_days[String(row.id)];
  return {
    name: row.name,
    nameEn: row.name_en ?? "",
    slug: row.slug,
    parentId: row.parent_id == null ? "" : String(row.parent_id),
    icon: row.icon ?? "",
    isActive: row.is_active,
    commission: row.commission_rate == null ? "" : String(row.commission_rate),
    feeOverride: fee == null ? "" : String(fee),
    escrowOverride: escrow == null ? "" : String(escrow),
  };
}

function Section({ title, hint, children, danger = false }: { title: string; hint?: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={cn("rounded-card border bg-card", danger ? "border-bad/30" : "border-line")}>
      <header className={cn("border-b px-4 py-2.5", danger ? "border-bad/20 bg-bad-soft/40" : "border-line bg-raised/40")}>
        <h3 className={cn("text-[13px] font-semibold", danger ? "text-bad" : "text-fg")}>{title}</h3>
        {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function FieldRow({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[150px_1fr] sm:items-start sm:gap-4">
      <span className="pt-2 text-[12.5px] font-medium text-muted">{label}</span>
      <div className="min-w-0">
        {children}
        {error ? <p className="mt-1 text-[12px] text-bad" role="alert">{error}</p> : hint ? <p className="mt-1 text-[12px] text-faint">{hint}</p> : null}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-1 font-mono text-[16px] font-semibold tabular-nums text-fg">{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export function CategoryDetailPanel({ mode, row, rows, fees, onClose, onOpen, onChanged }: {
  mode: PanelMode | null;
  row: CategoryAdminRow | null;
  rows: CategoryAdminRow[];
  fees: FeeConfigAdmin | undefined;
  onClose: () => void;
  onOpen: (next: PanelMode) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const apiErrorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const creating = mode?.kind === "create";
  const createParent = mode?.kind === "create" ? mode.parentId : null;
  const [form, setForm] = React.useState<Form>(() => initialForm(row, createParent, fees));
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  // Backdrop click / Esc while dirty: hold the panel and ask instead of dropping the edits.
  const [closeAttempt, setCloseAttempt] = React.useState(false);
  const modeKey = mode ? (mode.kind === "edit" ? `edit:${mode.id}` : `create:${mode.parentId ?? "root"}`) : "";

  // Edit mode needs its row (a freshly created one arrives with the next list refetch).
  const ready = creating || row !== null;
  const baseline = React.useMemo(() => initialForm(row, createParent, fees), [row, createParent, fees]);
  const [baselineKey, setBaselineKey] = React.useState("");
  const lastBaseline = React.useRef(baseline);
  React.useEffect(() => {
    if (!mode || !ready) return;
    if (modeKey !== baselineKey) {
      // New target: start clean.
      setForm(baseline); setSlugTouched(false); setConfirmDelete(false); setCloseAttempt(false); setBaselineKey(modeKey);
    } else {
      // Same target, server row / fee map refreshed: follow it unless the form was touched.
      setForm((cur) => (JSON.stringify(cur) === JSON.stringify(lastBaseline.current) ? baseline : cur));
    }
    lastBaseline.current = baseline;
  }, [mode, ready, modeKey, baselineKey, baseline]);
  const dirty = ready && baselineKey === modeKey && JSON.stringify(form) !== JSON.stringify(baseline);

  const update = (patch: Partial<Form>) => { setCloseAttempt(false); setForm((f) => ({ ...f, ...patch })); };
  const requestClose = () => { if (dirty) setCloseAttempt(true); else onClose(); };
  const discardAndClose = () => { setForm(baseline); setCloseAttempt(false); onClose(); };
  const setName = (name: string) => update(creating && !slugTouched ? { name, slug: slugFromName(name) } : { name });

  const blocked = row ? descendantIds(rows, row.id) : new Set<number>();
  const parentOptions = rows.filter((r) => !blocked.has(r.id));
  const parentPath = pathTo(rows, form.parentId === "" ? null : Number(form.parentId));
  const children = row ? rows.filter((r) => r.parent_id === row.id).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) : [];
  const ancestorHidden = row ? pathTo(rows, row.parent_id).some((p) => !p.is_active) : false;

  const problems: string[] = [];
  if (!form.name.trim()) problems.push("Tên danh mục là bắt buộc.");
  if (!form.slug.trim()) problems.push("Slug là bắt buộc.");
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim())) problems.push("Slug chỉ gồm chữ thường, số và dấu gạch ngang.");
  else if (rows.some((r) => r.slug === form.slug.trim() && r.id !== row?.id)) problems.push("Slug này đã được dùng ở danh mục khác.");
  if (!percentOk(form.commission)) problems.push("Hoa hồng affiliate phải từ 0 đến 100%.");
  if (!percentOk(form.feeOverride)) problems.push("Phí sàn riêng phải từ 0 đến 100%.");
  if (!daysOk(form.escrowOverride)) problems.push("Số ngày giữ tiền phải là số nguyên từ 0 đến 90.");
  const valid = problems.length === 0;

  /** Fee overrides live in the fee config maps; only touch them when they changed. */
  const saveFeeOverrides = async (id: number) => {
    if (!fees) return;
    const key = String(id);
    const feeMap = { ...fees.category_fee_percent };
    const escrowMap = { ...fees.category_escrow_min_days };
    const nextFee = numOrNull(form.feeOverride);
    const nextEscrow = numOrNull(form.escrowOverride);
    const feeChanged = (feeMap[key] ?? null) !== nextFee;
    const escrowChanged = (escrowMap[key] ?? null) !== nextEscrow;
    if (!feeChanged && !escrowChanged) return;
    if (nextFee == null) delete feeMap[key]; else feeMap[key] = nextFee;
    if (nextEscrow == null) delete escrowMap[key]; else escrowMap[key] = nextEscrow;
    await api.updateAdminFeeConfig({ category_fee_percent: feeMap, category_escrow_min_days: escrowMap });
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminFeeConfig() });
  };

  const save = useMutation({
    mutationFn: async () => {
      const parent_id = form.parentId === "" ? null : Number(form.parentId);
      if (creating) {
        const body: CategoryCreateInput = {
          name: form.name.trim(), name_en: form.nameEn.trim() || null, slug: form.slug.trim(),
          icon: form.icon || null, parent_id, commission_rate: numOrNull(form.commission),
        };
        const created = await api.createCategory(body);
        if (!form.isActive) await api.updateCategory(created.id, { is_active: false });
        await saveFeeOverrides(created.id);
        return created.id;
      }
      const patch: CategoryUpdateInput = {};
      if (form.name.trim() !== baseline.name) patch.name = form.name.trim();
      if (form.nameEn.trim() !== baseline.nameEn) patch.name_en = form.nameEn.trim();
      if (form.slug.trim() !== baseline.slug) patch.slug = form.slug.trim();
      if (form.icon !== baseline.icon) patch.icon = form.icon || null;
      if (form.parentId !== baseline.parentId) patch.parent_id = parent_id;
      if (form.isActive !== baseline.isActive) patch.is_active = form.isActive;
      if (form.commission !== baseline.commission) patch.commission_rate = numOrNull(form.commission);
      if (Object.keys(patch).length > 0) await api.updateCategory(row!.id, patch);
      await saveFeeOverrides(row!.id);
      return row!.id;
    },
    onSuccess: (id) => {
      setCloseAttempt(false);
      toast.success(creating ? `Đã tạo danh mục "${form.name.trim()}"` : "Đã lưu danh mục");
      onChanged();
      if (creating) onOpen({ kind: "edit", id });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Lưu danh mục thất bại")),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteCategory(row!.id),
    onSuccess: () => { toast.success(`Đã xoá danh mục "${row?.name}"`); setConfirmDelete(false); onChanged(); onClose(); },
    onError: (e) => { setConfirmDelete(false); toast.error(apiErrorMessage(e, "Xoá danh mục thất bại")); },
  });

  const deleteBlock = row
    ? row.product_count > 0 ? `Đang có ${row.product_count} sản phẩm trong danh mục này.`
      : row.child_count > 0 ? `Đang có ${row.child_count} danh mục con — chuyển hoặc xoá chúng trước.`
      : null
    : null;

  const title = creating ? (createParent != null ? "Danh mục con mới" : "Danh mục mới") : "Danh mục";
  const platformFee = fees?.platform_fee_percent;
  const floorDays = fees?.escrow_min_days;

  return (
    <SlidePanel isOpen={mode !== null} onClose={requestClose} title={title} width="lg">
      {mode && !ready && <div className="grid place-items-center py-16"><Spinner /></div>}
      {mode && ready && (
        <div className="space-y-4 pb-20">
          {/* Header */}
          <div className="flex items-start gap-3">
            <ProductCover coverId={categoryCoverId({ name: form.name || "?", icon: form.icon || null })} title={form.name || "Danh mục"} className="h-12 w-12 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              {parentPath.length > 0 && (
                <p className="flex flex-wrap items-center gap-1 text-[12px] text-faint">
                  {parentPath.map((p) => (
                    <React.Fragment key={p.id}>
                      <button type="button" className="hover:text-fg hover:underline" onClick={() => onOpen({ kind: "edit", id: p.id })}>{p.name}</button>
                      <ChevronRight size={12} />
                    </React.Fragment>
                  ))}
                </p>
              )}
              <h2 className="truncate text-[15px] font-semibold text-fg">{form.name.trim() || (creating ? "Danh mục chưa đặt tên" : row?.name)}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {row ? (
                  <>
                    {row.is_active ? <Tag tone="good">Đang hiển thị</Tag> : <Tag tone="neutral">Đã ẩn</Tag>}
                    {row.is_active && ancestorHidden && <Tag tone="warn">Cha đang ẩn</Tag>}
                    {row.child_count > 0 && <Tag tone="neutral">{row.child_count} danh mục con</Tag>}
                    <span className="font-mono text-[11.5px] text-faint">#{row.id}</span>
                  </>
                ) : (
                  <span className="text-[12px] text-muted">{createParent != null ? "Sẽ nằm trong danh mục cha ở trên." : "Sẽ là một danh mục cấp gốc."}</span>
                )}
              </div>
            </div>
          </div>

          <Section title="Thông tin" hint="Tên tiếng Việt dùng cho cửa hàng VI; tên tiếng Anh cho storefront EN (không tự dịch).">
            <div className="space-y-3">
              <FieldRow label="Tên (VI)">
                <Input value={form.name} onChange={(e) => setName(e.target.value)} placeholder="VD: Mạng xã hội" maxLength={100} autoFocus={creating} />
              </FieldRow>
              <FieldRow label="Tên (EN)" hint={form.nameEn.trim() ? undefined : "Chưa có — khách xem bản EN sẽ thấy tên tiếng Việt."}>
                <Input value={form.nameEn} onChange={(e) => update({ nameEn: e.target.value })} placeholder="VD: Social networks" maxLength={100} />
              </FieldRow>
              <FieldRow label="Slug" hint={creating ? "Tự tạo từ tên; sửa tay nếu muốn." : "Đổi slug sẽ đổi đường dẫn danh mục ở cửa hàng."}>
                <div className="flex items-center gap-2">
                  <Input value={form.slug} onChange={(e) => { setSlugTouched(true); update({ slug: e.target.value }); }} placeholder="vd: mang-xa-hoi" maxLength={100} className="font-mono text-[13px]" />
                  {!creating && form.slug !== slugFromName(form.name) && form.name.trim() && (
                    <Button size="sm" variant="ghost" onClick={() => update({ slug: slugFromName(form.name) })}>Tạo từ tên</Button>
                  )}
                </div>
              </FieldRow>
              <FieldRow label="Danh mục cha" hint={!creating && form.parentId !== baseline.parentId ? "Chuyển sang cha mới: danh mục sẽ xếp cuối trong nhánh đó." : undefined}>
                <Select value={form.parentId} onChange={(e) => update({ parentId: e.target.value })}>
                  <option value="">— Cấp gốc —</option>
                  {parentOptions.map((c) => {
                    const path = pathTo(rows, c.parent_id).map((p) => p.name);
                    return <option key={c.id} value={c.id}>{[...path, c.name].join(" › ")}{c.is_active ? "" : " (đã ẩn)"}</option>;
                  })}
                </Select>
              </FieldRow>
              <FieldRow label="Hiển thị" hint={form.isActive ? (ancestorHidden ? "Danh mục cha đang ẩn nên khách vẫn chưa thấy danh mục này." : "Khách thấy danh mục ở menu, trang chủ và tìm kiếm.") : "Ẩn khỏi cửa hàng; sản phẩm bên trong vẫn giữ nguyên."}>
                <span className={cn("flex items-center gap-3 pt-1.5 text-[13px]", form.isActive ? "font-medium text-fg" : "text-muted")}>
                  <Switch checked={form.isActive} onChange={(v) => update({ isActive: v })} label="Hiển thị ở cửa hàng" />
                  {form.isActive ? "Đang hiển thị" : "Đã ẩn"}
                </span>
              </FieldRow>
            </div>
          </Section>

          <Section title="Hình ảnh" hint="Chọn một cover có sẵn. Để trống thì đoán theo tên danh mục.">
            <CoverPicker value={form.icon || null} onChange={(id) => update({ icon: id ?? "" })} />
          </Section>

          <Section title="Phí & hoa hồng" hint="Để trống là dùng mức chung ở Cài đặt › Phí & giữ tiền. Mức riêng của danh mục cha không tự áp cho danh mục con.">
            <div className="space-y-3">
              <FieldRow label="Phí sàn riêng" hint={platformFee != null ? `Mặc định toàn sàn: ${platformFee}% mỗi đơn.` : undefined} error={percentOk(form.feeOverride) ? undefined : "0–100"}>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} max={100} step="0.1" value={form.feeOverride} onChange={(e) => update({ feeOverride: e.target.value })} placeholder={platformFee != null ? `Mặc định ${platformFee}` : "Mặc định"} className="max-w-[160px] text-right font-mono tabular-nums" />
                  <span className="text-[13px] text-muted">%</span>
                </div>
              </FieldRow>
              <FieldRow label="Giữ tiền tối thiểu" hint={floorDays != null ? `Sàn chung đang giữ ít nhất ${floorDays} ngày; seller không đặt thấp hơn mức này.` : undefined} error={daysOk(form.escrowOverride) ? undefined : "0–90 ngày"}>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} max={90} step="1" value={form.escrowOverride} onChange={(e) => update({ escrowOverride: e.target.value })} placeholder={floorDays != null ? `Mặc định ${floorDays}` : "Mặc định"} className="max-w-[160px] text-right font-mono tabular-nums" />
                  <span className="text-[13px] text-muted">ngày</span>
                </div>
              </FieldRow>
              <FieldRow label="Hoa hồng affiliate" hint="Áp cho sản phẩm trong danh mục không tự đặt hoa hồng." error={percentOk(form.commission) ? undefined : "0–100"}>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} max={100} step="0.1" value={form.commission} onChange={(e) => update({ commission: e.target.value })} placeholder="Kế thừa" className="max-w-[160px] text-right font-mono tabular-nums" />
                  <span className="text-[13px] text-muted">%</span>
                </div>
              </FieldRow>
              <p className="text-[12px] text-faint">
                Xem toàn bộ bảng phí ở <Link href="/admin/display-settings?tab=fees" className="text-iris-hi hover:underline">Cài đặt › Phí & giữ tiền</Link>.
              </p>
            </div>
          </Section>

          {row && (
            <Section title="Sản phẩm & danh mục con">
              <div className="grid gap-2 sm:grid-cols-3">
                <Stat label="Sản phẩm trực tiếp" value={row.product_count.toLocaleString("vi-VN")} sub={`${row.active_product_count} đang bán`} />
                <Stat label="Cả nhánh" value={row.branch_product_count.toLocaleString("vi-VN")} sub={`${row.branch_active_product_count} đang bán`} />
                <Stat label="Người bán" value={row.seller_count.toLocaleString("vi-VN")} sub="đăng trực tiếp" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link href={`/admin/products?category_id=${row.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-fg transition-colors hover:border-line-2">
                  Xem sản phẩm trong nhánh <ExternalLink size={13} />
                </Link>
                <Button size="sm" variant="secondary" onClick={() => onOpen({ kind: "create", parentId: row.id })}>Thêm danh mục con</Button>
              </div>
              {children.length > 0 && (
                <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                  {children.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => onOpen({ kind: "edit", id: c.id })} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-raised/40">
                        <ProductCover coverId={categoryCoverId(c)} title={c.name} className={cn("h-7 w-7 rounded-md", !c.is_active && "opacity-50 grayscale")} />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-[13px] font-medium", c.is_active ? "text-fg" : "text-muted")}>{c.name}</span>
                          <span className="block text-[11.5px] text-faint">{c.branch_active_product_count} đang bán{c.child_count > 0 ? ` · ${c.child_count} danh mục con` : ""}</span>
                        </span>
                        {!c.is_active && <Tag tone="neutral">Đã ẩn</Tag>}
                        <ChevronRight size={14} className="text-faint" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {row && (
            <Section title="Xoá danh mục" hint="Chỉ xoá được khi không còn sản phẩm và danh mục con." danger>
              {deleteBlock ? (
                <p className="flex items-start gap-2 text-[12.5px] text-muted"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />{deleteBlock} Muốn giấu khỏi cửa hàng thì tắt “Hiển thị” ở trên.</p>
              ) : confirmDelete ? (
                <div className="space-y-2">
                  <p className="text-[12.5px] text-fg">Xoá hẳn “{row.name}” khỏi hệ thống? Không hoàn tác được.</p>
                  <div className="flex gap-2">
                    <Button variant="danger" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending ? "Đang xoá…" : "Xoá vĩnh viễn"}</Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>Giữ lại</Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Xoá danh mục…</Button>
              )}
            </Section>
          )}

          {/* Sticky save bar */}
          <div className={cn(
            "fixed bottom-0 right-0 z-[80] flex w-full max-w-[600px] items-center gap-3 border-t px-5 py-3 transition-colors",
            dirty ? "border-warn/40 bg-warn-soft" : "border-line bg-surface",
          )}>
            <span className="min-w-0 flex-1 text-[12.5px]">
              {closeAttempt ? (
                <span className="font-medium text-bad">Đóng sẽ mất thay đổi chưa lưu.</span>
              ) : !valid && dirty ? (
                <span className="text-bad">{problems[0]}</span>
              ) : dirty ? (
                <span className="font-medium text-fg">{creating ? "Điền xong thì bấm tạo." : "Có thay đổi chưa lưu."}</span>
              ) : (
                <span className="text-muted">{creating ? "Đặt tên để bắt đầu." : "Không có thay đổi."}</span>
              )}
            </span>
            {closeAttempt && <Button variant="danger" size="sm" onClick={discardAndClose}>Bỏ thay đổi</Button>}
            {dirty && !creating && !closeAttempt && <Button variant="ghost" size="sm" onClick={() => { setForm(baseline); setSlugTouched(false); }} disabled={save.isPending}>Hoàn tác</Button>}
            <Button onClick={() => save.mutate()} disabled={!dirty || !valid || save.isPending}>
              {save.isPending ? "Đang lưu…" : creating ? "Tạo danh mục" : "Lưu thay đổi"}
            </Button>
          </div>
        </div>
      )}

    </SlidePanel>
  );
}
