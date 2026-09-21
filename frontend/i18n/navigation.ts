import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

export { Link } from "./link";

export const { redirect, permanentRedirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
