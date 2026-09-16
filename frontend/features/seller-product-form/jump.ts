"use client";

import type { ChecklistJump, FormSection } from "./model";

export const SECTION_DOM_ID: Record<FormSection, string> = {
  basics: "section-basics",
  variants: "section-variants",
  content: "section-content",
  advanced: "section-advanced",
};

/** Scroll a section into view and focus the field once it has rendered (a
 *  collapsed section or a tab switch mounts it on the next frame). */
export function scrollToJump(target: ChecklistJump) {
  window.setTimeout(() => {
    const section = document.getElementById(SECTION_DOM_ID[target.section]);
    const field = target.field ? document.getElementById(target.field) : null;
    (field ?? section)?.scrollIntoView({ block: field ? "center" : "start" });
    if (field) (field as HTMLElement).focus({ preventScroll: true });
  }, 30);
}
