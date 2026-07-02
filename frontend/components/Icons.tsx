import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function s({ size = 18, ...props }: IconProps) {
  return {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.75,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...props,
  };
}

export const Store = (p: IconProps) => (
  <svg {...s(p)}><path d="M3 9 4.5 4h15L21 9" /><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" /><path d="M3 9h18" /><path d="M9 20v-6h6v6" /></svg>
);
export const Receipt = (p: IconProps) => (
  <svg {...s(p)}><path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1Z" /><path d="M9 8h6" /><path d="M9 12h6" /></svg>
);
export const Plug = (p: IconProps) => (
  <svg {...s(p)}><path d="M9 2v6" /><path d="M15 2v6" /><path d="M7 8h10v3a5 5 0 0 1-10 0Z" /><path d="M12 16v6" /></svg>
);
export const Wallet = (p: IconProps) => (
  <svg {...s(p)}><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" /><path d="M16 12h.02" /></svg>
);
export const Search = (p: IconProps) => (
  <svg {...s(p)}><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.3-4.3" /></svg>
);
export const Sliders = (p: IconProps) => (
  <svg {...s(p)}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="9" cy="7" r="2.4" fill="var(--color-base)" /><circle cx="15" cy="17" r="2.4" fill="var(--color-base)" /></svg>
);
export const Grid = (p: IconProps) => (
  <svg {...s(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);
export const Rows = (p: IconProps) => (
  <svg {...s(p)}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /></svg>
);
export const Verified = (p: IconProps) => (
  <svg {...s(p)}><path d="m9 12 2 2 4-4" /><path d="M12 2.5 14.5 4l3-.2.7 2.9 2.3 1.9-1.2 2.7 1.2 2.7-2.3 1.9-.7 2.9-3-.2L12 21.5 9.5 20l-3 .2-.7-2.9-2.3-1.9 1.2-2.7-1.2-2.7 2.3-1.9.7-2.9 3 .2Z" /></svg>
);
export const Bolt = (p: IconProps) => (
  <svg {...s(p)}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>
);
export const Clock = (p: IconProps) => (
  <svg {...s(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const Check = (p: IconProps) => (
  <svg {...s(p)}><path d="M20 6 9 17l-5-5" /></svg>
);
export const Plus = (p: IconProps) => (
  <svg {...s(p)}><path d="M5 12h14" /><path d="M12 5v14" /></svg>
);
export const ArrowRight = (p: IconProps) => (
  <svg {...s(p)}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
);
export const LogOut = (p: IconProps) => (
  <svg {...s(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
);
export const Shield = (p: IconProps) => (
  <svg {...s(p)}><path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const Panel = (p: IconProps) => (
  <svg {...s(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
);
export const Star = (p: IconProps) => (
  <svg {...s(p)}><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z" /></svg>
);
export const Package = (p: IconProps) => (
  <svg {...s(p)}><path d="m16.5 9.4-9-5.19" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.27 6.96 12 12.01l8.73-5.05" /><path d="M12 22.08V12" /></svg>
);
export const MessageCircle = (p: IconProps) => (
  <svg {...s(p)}><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
);
export const Info = (p: IconProps) => (
  <svg {...s(p)}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
);
export const ChevronRight = (p: IconProps) => (
  <svg {...s(p)}><path d="m9 18 6-6-6-6" /></svg>
);
export const Edit2 = (p: IconProps) => (
  <svg {...s(p)}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" /></svg>
);
export const Trash = (p: IconProps) => (
  <svg {...s(p)}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);
export const Eye = (p: IconProps) => (
  <svg {...s(p)}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const BarChart = (p: IconProps) => (
  <svg {...s(p)}><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>
);
export const Inbox = (p: IconProps) => (
  <svg {...s(p)}><path d="M22 12h-6l-2 3H10l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" /></svg>
);
export const Copy = (p: IconProps) => (
  <svg {...s(p)}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);

export const Activity = (p: IconProps) => (
  <svg {...s(p)}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
);
export const Bell = (p: IconProps) => (
  <svg {...s(p)}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
);
export const FileText = (p: IconProps) => (
  <svg {...s(p)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h6" /><path d="M9 17h6" /></svg>
);
export const ChevronLeft = (p: IconProps) => (
  <svg {...s(p)}><path d="m15 18-6-6 6-6" /></svg>
);
export const Menu = (p: IconProps) => (
  <svg {...s(p)}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg>
);
export const X = (p: IconProps) => (
  <svg {...s(p)}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);
export const Users = (p: IconProps) => (
  <svg {...s(p)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
export const TrendingUp = (p: IconProps) => (
  <svg {...s(p)}><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></svg>
);
export const ClipboardList = (p: IconProps) => (
  <svg {...s(p)}><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></svg>
);

/** Brand mark — an aperture/gateway hexagon. Serious, premium. */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid place-items-center h-8 w-8 rounded-[8px] bg-iris/15 border border-iris/30">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7Z" stroke="var(--color-iris-hi)" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M12 8 16 10.2v3.6L12 16l-4-2.2v-3.6Z" fill="var(--color-iris-hi)" opacity="0.9" />
        </svg>
      </span>
      {withName && <span className="font-serif text-[19px] font-semibold tracking-tight">Proxora</span>}
    </span>
  );
}
