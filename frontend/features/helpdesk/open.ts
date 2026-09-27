/** Open the "Chat với GMMO" panel from anywhere, with a message ready to
 *  send (e.g. a top-up code to check). The launcher listens for this event. */

import type { HelpdeskRole } from "../../lib/types.ts";

export const HELPDESK_OPEN_EVENT = "helpdesk:open";

export type HelpdeskOpenDetail = { draft?: string; role?: HelpdeskRole };

export function openHelpdesk(detail: HelpdeskOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent<HelpdeskOpenDetail>(HELPDESK_OPEN_EVENT, { detail }));
}
