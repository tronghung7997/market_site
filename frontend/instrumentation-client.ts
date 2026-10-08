import { startNavigation } from "./lib/nav-progress";

/** Every App Router navigation — <Link>, router.push/replace, back/forward —
 *  starts the top progress bar. */
export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse") {
  startNavigation(url, navigationType);
}
