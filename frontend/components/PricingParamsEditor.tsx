"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";

/* ================================================================
   Editor cho tham số chiến lược giá (config/credit/task) — dùng chung
   cho cả trang admin và trang seller, thay cho 2 bản gần-giống-nhau
   từng tồn tại độc lập ở mỗi trang.

   LabeledMultEditor: mỗi lựa chọn = 1 dòng "Nhãn khách thấy" + "Mã máy
   gửi cho nhà cung cấp" + "Hệ số giá" — tách biệt rõ cái buyer đọc được
   khỏi cái được gửi nguyên văn cho API nhà cung cấp thật (xem
   RealApiAdapter.provision, gửi user_config y nguyên). Mã máy để trống
   thì tự dùng luôn nhãn làm mã, giữ hành vi cũ (key == label).

   Mọi input có bề rộng cố định đều bọc trong 1 div riêng thay vì gán
   thẳng class w-[Npx] lên <Input> — <Input> tự có w-full, đặt 2 class
   width lên cùng 1 phần tử là 2 utility cùng specificity giẫm lên
   nhau, thắng-thua phụ thuộc thứ tự Tailwind sinh CSS chứ không phải
   thứ tự viết trong className (đã ăn bug này một lần — ô hệ số kéo dài
   hết hàng vì w-full thắng w-[90px]).
   ================================================================ */

type MultParams = Record<string, unknown>;

function Cell({ width, children }: { width: string; children: React.ReactNode }) {
  return <div className={`${width} shrink-0`}>{children}</div>;
}

function LabeledMultEditor({
  sectionTitle,
  fieldLabelKey,
  defaultFieldLabel,
  multKey,
  displayKey,
  params,
  onChange,
}: {
  sectionTitle: string;
  fieldLabelKey: string;
  defaultFieldLabel: string;
  multKey: string;
  displayKey: string;
  params: MultParams;
  onChange: (params: MultParams) => void;
}) {
  const mult = (params[multKey] as Record<string, number>) ?? {};
  const display = (params[displayKey] as Record<string, string>) ?? {};
  const fieldLabels = (params.field_labels as Record<string, string>) ?? {};

  const [newLabel, setNewLabel] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newMult, setNewMult] = useState("1");

  const setFieldLabel = (v: string) => {
    onChange({ ...params, field_labels: { ...fieldLabels, [fieldLabelKey]: v || undefined } });
  };

  const addOption = () => {
    const label = newLabel.trim();
    if (!label) return;
    const code = newCode.trim() || label;
    onChange({
      ...params,
      [multKey]: { ...mult, [code]: Number(newMult) || 0 },
      [displayKey]: { ...display, [code]: label },
    });
    setNewLabel(""); setNewCode(""); setNewMult("1");
  };

  const removeOption = (code: string) => {
    const nextMult = { ...mult }; delete nextMult[code];
    const nextDisplay = { ...display }; delete nextDisplay[code];
    onChange({ ...params, [multKey]: nextMult, [displayKey]: nextDisplay });
  };

  const updateMultVal = (code: string, v: number) => {
    onChange({ ...params, [multKey]: { ...mult, [code]: v } });
  };

  const codes = Object.keys(mult);

  return (
    <div className="rounded-lg border border-line bg-raised/40 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12px] font-semibold">{sectionTitle}</div>
        <input
          className="h-7 rounded-md bg-surface border border-line px-2 text-[11.5px] text-muted focus:border-iris focus:text-fg outline-none w-[180px]"
          placeholder={`Tên nhóm buyer thấy (mặc định: "${defaultFieldLabel}")`}
          value={fieldLabels[fieldLabelKey] ?? ""}
          onChange={(e) => setFieldLabel(e.target.value)}
        />
      </div>

      {codes.length === 0 && (
        <p className="text-[12px] text-faint">Chưa có lựa chọn nào — thêm ít nhất 1 lựa chọn bên dưới.</p>
      )}

      {codes.map((code) => (
        <div key={code} className="flex items-center gap-2 flex-wrap sm:flex-nowrap rounded-md border border-line/70 bg-surface px-2 py-2 sm:border-transparent sm:bg-transparent sm:px-0 sm:py-0">
          <div className="flex-1 min-w-[120px]">
            <Input
              value={display[code] ?? code}
              onChange={(e) => onChange({ ...params, [displayKey]: { ...display, [code]: e.target.value } })}
              placeholder="Nhãn khách thấy"
            />
          </div>
          <span
            className="text-[11px] font-mono bg-surface border border-line rounded px-2 py-2 text-faint shrink-0"
            title="Mã máy gửi cho nhà cung cấp — không đổi được sau khi tạo, xoá và thêm lại nếu cần đổi."
          >
            {code}
          </span>
          <Cell width="w-[80px]"><Input type="number" value={mult[code]} onChange={(e) => updateMultVal(code, Number(e.target.value))} /></Cell>
          <button onClick={() => removeOption(code)} className="text-bad text-[12px] hover:underline shrink-0">Xoá</button>
        </div>
      ))}

      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-2 border-t border-line/60 mt-1">
        <div className="flex-1 min-w-[120px]">
          <Input placeholder="Nhãn khách thấy (VD: Dân cư)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
        </div>
        <Cell width="w-[130px]"><Input placeholder="Mã máy (tuỳ chọn)" value={newCode} onChange={(e) => setNewCode(e.target.value)} /></Cell>
        <Cell width="w-[80px]"><Input type="number" placeholder="Hệ số" value={newMult} onChange={(e) => setNewMult(e.target.value)} /></Cell>
        <Button size="sm" variant="secondary" onClick={addOption} className="shrink-0">Thêm</Button>
      </div>
      <p className="text-[11px] text-faint">
        Mã máy là giá trị gửi thẳng cho nhà cung cấp/công thức tính giá — để trống thì hệ thống tự dùng nhãn làm mã.
      </p>
    </div>
  );
}

/* ── Editor cho 3 tham số dạng danh sách cấu trúc cố định — không còn
   JSON thô, mỗi tham số có form nhập đúng field của nó. ──────────── */

function DurationOptionsEditor({ value, onChange }: {
  value: { days: number; label?: string }[];
  onChange: (v: { days: number; label?: string }[]) => void;
}) {
  const [days, setDays] = useState("");
  const [label, setLabel] = useState("");

  const add = () => {
    const d = Number(days);
    if (!d || d <= 0) return;
    onChange([...value, { days: d, label: label.trim() || `${d} ngày` }]);
    setDays(""); setLabel("");
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted">Tuỳ chọn thời hạn</div>
      {value.length === 0 && <p className="text-[12px] text-faint">Chưa có tuỳ chọn thời hạn nào.</p>}
      {value.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[12.5px] bg-raised rounded-md px-2.5 py-1.5 flex-1">
            <strong>{o.days} ngày</strong>{o.label ? ` — ${o.label}` : ""}
          </span>
          <button onClick={() => remove(i)} className="text-bad text-[12px] hover:underline shrink-0">Xoá</button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-1 border-t border-line/60 mt-1">
        <Cell width="w-[100px]"><Input type="number" placeholder="Số ngày" value={days} onChange={(e) => setDays(e.target.value)} /></Cell>
        <div className="flex-1 min-w-[120px]">
          <Input placeholder="Nhãn hiển thị (VD: 7 ngày)" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <Button size="sm" variant="secondary" onClick={add} className="shrink-0">Thêm</Button>
      </div>
    </div>
  );
}

function VolumeTiersEditor({ value, onChange }: {
  value: { min_qty: number; discount: number }[];
  onChange: (v: { min_qty: number; discount: number }[]) => void;
}) {
  const [minQty, setMinQty] = useState("");
  const [discountPct, setDiscountPct] = useState("");

  const add = () => {
    const q = Number(minQty);
    const p = Number(discountPct);
    if (!q || q <= 0 || !(p > 0 && p <= 100)) return;
    onChange([...value, { min_qty: q, discount: p / 100 }]);
    setMinQty(""); setDiscountPct("");
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted">Giảm giá theo số lượng</div>
      {value.length === 0 && <p className="text-[12px] text-faint">Mua càng nhiều càng rẻ — chưa có mức giảm nào.</p>}
      {value.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[12.5px] bg-raised rounded-md px-2.5 py-1.5 flex-1">
            Từ <strong>{t.min_qty}</strong> đơn vị → giảm <strong>{Math.round(t.discount * 100)}%</strong>
          </span>
          <button onClick={() => remove(i)} className="text-bad text-[12px] hover:underline shrink-0">Xoá</button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-1 border-t border-line/60 mt-1">
        <Cell width="w-[120px]"><Input type="number" placeholder="Từ số lượng" value={minQty} onChange={(e) => setMinQty(e.target.value)} /></Cell>
        <Cell width="w-[110px]"><Input type="number" placeholder="Giảm (%)" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} /></Cell>
        <Button size="sm" variant="secondary" onClick={add} className="shrink-0">Thêm</Button>
      </div>
    </div>
  );
}

function PackagesEditor({ value, onChange }: {
  value: { size: number; label?: string }[];
  onChange: (v: { size: number; label?: string }[]) => void;
}) {
  const [size, setSize] = useState("");
  const [label, setLabel] = useState("");

  const add = () => {
    const s = Number(size);
    if (!s || s <= 0) return;
    onChange([...value, { size: s, label: label.trim() || `${s.toLocaleString("vi-VN")} credits` }]);
    setSize(""); setLabel("");
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted">Gói credit bán ra</div>
      {value.length === 0 && <p className="text-[12px] text-faint">Chưa có gói nào — thêm ít nhất 1 gói để bán được.</p>}
      {value.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[12.5px] bg-raised rounded-md px-2.5 py-1.5 flex-1">
            <strong>{p.size.toLocaleString("vi-VN")} credit</strong>{p.label ? ` — ${p.label}` : ""}
          </span>
          <button onClick={() => remove(i)} className="text-bad text-[12px] hover:underline shrink-0">Xoá</button>
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-1 border-t border-line/60 mt-1">
        <Cell width="w-[110px]"><Input type="number" placeholder="Số credit" value={size} onChange={(e) => setSize(e.target.value)} /></Cell>
        <div className="flex-1 min-w-[120px]">
          <Input placeholder="Nhãn hiển thị (VD: Gói nhỏ)" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <Button size="sm" variant="secondary" onClick={add} className="shrink-0">Thêm</Button>
      </div>
    </div>
  );
}

export function PricingParamsEditor({ strategy, params, onChange }: {
  strategy: string;
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const setParam = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value });
  };

  if (strategy === "config") {
    return (
      <div className="space-y-4">
        <Field label="Giá cơ bản (VND)">
          <Input type="number" value={(params.base_price as number) ?? ""} onChange={(e) => setParam("base_price", Number(e.target.value) || 0)} />
        </Field>
        <LabeledMultEditor
          sectionTitle="Loại proxy (type_mult)"
          fieldLabelKey="type" defaultFieldLabel="Loại proxy"
          multKey="type_mult" displayKey="type_display"
          params={params} onChange={onChange}
        />
        <LabeledMultEditor
          sectionTitle="Nhà mạng / loại IP (network_mult)"
          fieldLabelKey="network" defaultFieldLabel="Nhà mạng"
          multKey="network_mult" displayKey="network_display"
          params={params} onChange={onChange}
        />
        <DurationOptionsEditor value={(params.duration_options as { days: number; label?: string }[]) ?? []} onChange={(v) => setParam("duration_options", v)} />
        <VolumeTiersEditor value={(params.volume_tiers as { min_qty: number; discount: number }[]) ?? []} onChange={(v) => setParam("volume_tiers", v)} />
      </div>
    );
  }

  if (strategy === "credit") {
    return (
      <div className="space-y-4">
        <Field label="Giá mỗi credit (VND)">
          <Input type="number" value={(params.credit_price as number) ?? ""} onChange={(e) => setParam("credit_price", Number(e.target.value) || 0)} />
        </Field>
        <PackagesEditor value={(params.packages as { size: number; label?: string }[]) ?? []} onChange={(v) => setParam("packages", v)} />
        <VolumeTiersEditor value={(params.volume_tiers as { min_qty: number; discount: number }[]) ?? []} onChange={(v) => setParam("volume_tiers", v)} />
      </div>
    );
  }

  if (strategy === "task") {
    return (
      <div className="space-y-4">
        <Field label="Giá cơ bản (VND)">
          <Input type="number" value={(params.base_price as number) ?? ""} onChange={(e) => setParam("base_price", Number(e.target.value) || 0)} />
        </Field>
        <LabeledMultEditor
          sectionTitle="Nền tảng (platform_mult)"
          fieldLabelKey="platform" defaultFieldLabel="Nền tảng"
          multKey="platform_mult" displayKey="platform_display"
          params={params} onChange={onChange}
        />
        <VolumeTiersEditor value={(params.volume_tiers as { min_qty: number; discount: number }[]) ?? []} onChange={(v) => setParam("volume_tiers", v)} />
      </div>
    );
  }

  return null;
}
