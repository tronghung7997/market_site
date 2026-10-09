"""Allowlist sanitizer for the HTML announcement bar.

The storefront renders the result with ``dangerouslySetInnerHTML``, so the
output is rebuilt from scratch rather than filtered: only the tags below
survive, every other tag is dropped (its text kept, escaped), and the content
of script-like elements is dropped with them. Attributes are never copied
except a link's ``href``, which must be an absolute http(s) or mailto URL; every
link opens in a new tab with ``rel="noopener noreferrer"``.

Standard library only (``html.parser``): no attribute or markup of the input is
ever echoed, so parser quirks cannot smuggle anything through.
"""
from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser

# Inline formatting only: the bar is one line.
ALLOWED_TAGS = frozenset({"b", "strong", "i", "em", "u", "a", "br", "span"})
_VOID_TAGS = frozenset({"br"})
# Elements whose content is code or not meant as text: dropped with the tag.
_DROP_CONTENT_TAGS = frozenset({
    "script", "style", "iframe", "object", "embed", "noscript", "template", "textarea",
    "title", "svg", "math", "select", "xmp", "noembed", "noframes", "plaintext", "head",
})
_SAFE_HREF = re.compile(r"^(?:https?://|mailto:)", re.IGNORECASE)
_URL_FORBIDDEN = re.compile(r"[\x00-\x20\x7f]")


def _safe_href(value: str | None) -> str | None:
    """An absolute http(s)/mailto URL, else None. Browsers ignore tabs and
    newlines inside a scheme ("java\\tscript:"), so any control or blank
    character rejects the URL outright instead of being stripped."""
    if not value:
        return None
    url = value.strip()
    if not url or _URL_FORBIDDEN.search(url) or not _SAFE_HREF.match(url):
        return None
    return url


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.open: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _DROP_CONTENT_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth or tag not in ALLOWED_TAGS:
            return
        if tag in _VOID_TAGS:
            self.out.append(f"<{tag}>")
            return
        if tag == "a":
            href = _safe_href(dict(attrs).get("href"))
            if href is None:
                # Keep the text, lose the link.
                self.open.append("a!")
                return
            self.out.append(f'<a href="{escape(href, quote=True)}" target="_blank" rel="noopener noreferrer">')
        else:
            self.out.append(f"<{tag}>")
        self.open.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _VOID_TAGS:
            self.handle_starttag(tag, attrs)
        # "<a/>", "<script/>" and friends open nothing worth keeping.

    def handle_endtag(self, tag: str) -> None:
        if tag in _DROP_CONTENT_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth or tag not in ALLOWED_TAGS or tag in _VOID_TAGS:
            return
        names = [name.rstrip("!") for name in self.open]
        if tag not in names:
            return
        # Close everything opened after the matching tag (mis-nested input).
        while self.open:
            name = self.open.pop()
            if not name.endswith("!"):
                self.out.append(f"</{name}>")
            if name.rstrip("!") == tag:
                break

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.out.append(escape(data, quote=False))

    def close_all(self) -> str:
        self.close()
        while self.open:
            name = self.open.pop()
            if not name.endswith("!"):
                self.out.append(f"</{name}>")
        return "".join(self.out)


def sanitize_announcement_html(raw: str) -> str:
    """The allowlisted subset of ``raw`` as safe HTML. Idempotent."""
    parser = _Sanitizer()
    parser.feed(raw or "")
    return parser.close_all().strip()
