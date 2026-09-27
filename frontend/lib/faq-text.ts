/** Q&A lists edited as plain text: blocks separated by a blank line, the
 *  first line of a block is the question and the rest is the answer. Used by
 *  the seller product form and the admin category editor. */

export interface FaqPair {
  q: string;
  a: string;
}

export function parseFaqBlocks(raw: string): FaqPair[] {
  return raw
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length >= 2)
    .map(([q, ...rest]) => ({ q, a: rest.join("\n") }));
}

export function faqToText(items: FaqPair[]): string {
  return items.map((item) => `${item.q}\n${item.a}`).join("\n\n");
}
