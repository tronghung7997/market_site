"use client";

import { createNavigation } from "next-intl/navigation";
import {
  forwardRef,
  useCallback,
  useState,
  type ComponentProps,
  type ComponentRef,
  type FocusEvent,
  type MouseEvent,
  type TouchEvent,
} from "react";
import { routing } from "./routing";

const { Link: IntlLink } = createNavigation(routing);

type IntlLinkProps = ComponentProps<typeof IntlLink>;
type IntlLinkElement = ComponentRef<typeof IntlLink>;

/**
 * Storefront `Link` with intent-based prefetching.
 *
 * Every storefront page renders dynamically (cookies/geo in the root layout),
 * so Next's default viewport prefetch turned one home-page view into ~25 extra
 * SSR round-trips to the origin before the visitor touched anything. Prefetch
 * now starts on hover / focus / touch instead, which keeps the click-through
 * feeling instant for links the visitor is actually heading to. Passing
 * `prefetch` explicitly (`true`, `false`, `null`) restores Next's behaviour.
 */
export const Link = forwardRef<IntlLinkElement, IntlLinkProps>(function Link(
  { prefetch, onMouseEnter, onFocus, onTouchStart, ...props },
  ref,
) {
  const [intent, setIntent] = useState(false);
  const markIntent = useCallback(() => setIntent(true), []);
  const effectivePrefetch = prefetch === undefined ? (intent ? null : false) : prefetch;

  return (
    <IntlLink
      ref={ref}
      prefetch={effectivePrefetch}
      onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) => {
        markIntent();
        onMouseEnter?.(event);
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        markIntent();
        onFocus?.(event);
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        markIntent();
        onTouchStart?.(event);
      }}
      {...props}
    />
  );
});
