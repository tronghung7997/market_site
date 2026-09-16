import { Star } from "@/components/Icons";

export function ReviewStars({ rating, size = 11 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${rating}/5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={size} className={s <= rating ? "text-warn fill-warn" : "text-line-2"} />
      ))}
    </span>
  );
}
