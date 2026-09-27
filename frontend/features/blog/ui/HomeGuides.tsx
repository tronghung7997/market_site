"use client";

/** The newest guides and marketplace news on the home page; hidden until
 *  the first post is published. */

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { ArrowRight } from "@/components/Icons";
import { SectionHead } from "@/components/home/SectionHead";
import { PostCard } from "./PostCard";

export function HomeGuides() {
  const t = useTranslations("blog");
  const th = useTranslations("home");
  const locale = useLocale();
  const posts = useQuery({ queryKey: ["public-posts", 3], queryFn: () => api.publicPosts(3), staleTime: 5 * 60_000 });
  const items = posts.data?.items ?? [];
  if (items.length === 0) return null;
  const date = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium" });
  return (
    <section className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-6 lg:py-8">
      <div className="flex items-end justify-between gap-3">
        <SectionHead title={th("guidesTitle")} sub={th("guidesSubtitle")} />
        <Link href="/blog" className="mb-3.5 inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-iris-hi hover:underline">
          {th("guidesAll")} <ArrowRight size={13} />
        </Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((post) => (
          <li key={post.slug}>
            <PostCard post={post} categoryLabel={t(`categories.${post.category}`)} date={date.format(new Date(post.published_at))} />
          </li>
        ))}
      </ul>
    </section>
  );
}
