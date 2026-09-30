import { cn } from "@/lib/cn";
import { nameTokens } from "@/lib/name-tokens";

/** A long name ("Clone Việt 5-30 Posts | 30-1000 BB | REG 6.2025 | Avatar")
 *  shown whole: its first part as the name, the rest as wrapping attribute
 *  chips — nothing is cut, and the parts that differ stay readable. */
export function NameParts({ name, size = "md", strong = true, className }: {
  name: string;
  size?: "sm" | "md" | "lg";
  strong?: boolean;
  className?: string;
}) {
  const [head, ...rest] = nameTokens(name);
  if (!head) return <span className={className}>{name}</span>;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      <span className={cn(
        "break-words text-fg",
        strong && "font-semibold",
        size === "lg" ? "text-[15px] font-bold" : size === "sm" ? "text-[12.5px]" : "text-[13px]",
      )}>{head}</span>
      {rest.map((part, i) => (
        <span key={i} className={cn(
          "rounded border border-line bg-raised px-1.5 font-medium text-muted",
          size === "lg" ? "py-0.5 text-[11.5px]" : "text-[10.5px] leading-[18px]",
        )}>{part}</span>
      ))}
    </span>
  );
}
