"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Check } from "@/components/Icons";
import type { ProxyLineFacets } from "@/lib/types";
import { EXPIRY_FILTERS, IP_TYPES, ROTATIONS, UNTAGGED, type ExpiryFilter, type ProxyFilters, type ProxyTag } from "../model";
import { TagDot } from "./ProxyTagChip";

function RailRow({
  active, onClick, children, count, swatch,
}: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number; swatch?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris",
        active ? "bg-iris-soft font-semibold text-iris-hi" : "text-muted",
      )}
    >
      {swatch ?? (
        <span className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded border", active ? "border-iris bg-iris text-white" : "border-line-2 bg-surface")}>
          {active && <Check size={9} />}
        </span>
      )}
      <span className="min-w-0 flex-1 break-words leading-snug">{children}</span>
      {count != null && (
        <span className={cn("font-mono text-[11px] tabular", active ? "text-iris-hi" : count === 0 ? "text-faint/60" : "text-muted")}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
        <span>{title}</span>{action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** Left rail: tags · IP type · rotation · expiry window. Multi-select inside a
 *  section, AND across sections and with the status tab + search (the server
 *  applies them). Counts are the list response's `facets`: how many lines each
 *  option would show under every OTHER active filter. There is deliberately no
 *  "source" section — buyers do not know which supplier fulfilled a line. */
export function ProxyFilterRail({
  filters, tags, facets, onChange, onManageTags, className,
}: {
  filters: ProxyFilters;
  tags: ProxyTag[];
  /** `null` while the first page loads — counts are hidden, not zeroed. */
  facets: ProxyLineFacets | null;
  onChange: (patch: Partial<ProxyFilters>) => void;
  onManageTags: () => void;
  className?: string;
}) {
  const t = useTranslations("buyerProxies");
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const sortedTags = [...tags].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  // Muted when an option would empty the list — still clickable (filters stay combinable).

  return (
    <nav aria-label={t("rail.label")} className={cn("rounded-card border border-line bg-card p-2 shadow-card", className)}>
      <Section
        title={t("rail.tags")}
        action={<button type="button" onClick={onManageTags} className="rounded text-[11px] font-medium normal-case tracking-normal text-iris hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">{t("rail.manageTags")}</button>}
      >
        {sortedTags.map((tag) => (
          <RailRow
            key={tag.id}
            active={filters.tags.includes(tag.id)}
            count={facets ? facets.tags[tag.id] ?? 0 : undefined}
            onClick={() => onChange({ tags: toggle(filters.tags, tag.id), page: 1 })}
            swatch={<TagDot tone={tag.tone} className={cn("ml-0.5 mr-0.5", filters.tags.includes(tag.id) && "ring-2 ring-iris/30")} />}
          >
            {tag.name}
          </RailRow>
        ))}
        <RailRow
          active={filters.tags.includes(UNTAGGED)}
          count={facets?.tags[UNTAGGED]}
          onClick={() => onChange({ tags: toggle(filters.tags, UNTAGGED), page: 1 })}
          swatch={<span aria-hidden className="ml-0.5 mr-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-[3px] border border-dashed border-line-2" />}
        >
          {t("rail.untagged")}
        </RailRow>
      </Section>

      <Section title={t("rail.ipType")}>
        {IP_TYPES.map((v) => (
          <RailRow key={v} active={filters.ipTypes.includes(v)} count={facets?.ip_type[v]} onClick={() => onChange({ ipTypes: toggle(filters.ipTypes, v), page: 1 })}>
            {t(`ipType.${v}`)}
          </RailRow>
        ))}
      </Section>

      <Section title={t("rail.rotation")}>
        {ROTATIONS.map((v) => (
          <RailRow key={v} active={filters.rotations.includes(v)} count={facets?.rotation[v]} onClick={() => onChange({ rotations: toggle(filters.rotations, v), page: 1 })}>
            {t(`rotation.${v}`)}
          </RailRow>
        ))}
      </Section>

      <Section title={t("rail.expiry")}>
        {EXPIRY_FILTERS.filter((e): e is Exclude<ExpiryFilter, ""> => e !== "").map((e) => (
          <RailRow key={e} active={filters.expiry === e} count={facets?.expires[e]} onClick={() => onChange({ expiry: filters.expiry === e ? "" : e, page: 1 })}>
            {t(`expiry.${e}`)}
          </RailRow>
        ))}
      </Section>
    </nav>
  );
}
