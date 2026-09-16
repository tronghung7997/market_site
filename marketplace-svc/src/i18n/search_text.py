"""SQL building blocks for diacritic-insensitive, typo-tolerant text search.

Every searchable corpus (``products.search_text``, ``categories.search_text``,
``immutable_unaccent(lower(seller_applications.business_name))``) is stored
lower-cased and unaccented by PostgreSQL. The user's query goes through the
*same* database function, so "Tài Khoản", "tai khoan" and "TAI KHOAN" all
become ``tai khoan`` on both sides and the comparison is exact.

Matching tiers (all served by the GIN ``gin_trgm_ops`` index):

1. substring ``LIKE '%needle%'`` — the primary hit;
2. ``needle <% corpus`` (pg_trgm word similarity, threshold 0.6) — typo
   tolerance such as "facebok" → "facebook", only from ``FUZZY_MIN_CHARS``
   so two-letter queries never fan out into noise.

Ranking puts prefix matches first, then word-boundary matches, then plain
substrings, then fuzzy-only hits; callers append their own popularity
tie-breakers (sold_count, sort_order, …).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import ColumnElement, case, func, literal, or_

MAX_QUERY_LENGTH = 80
FUZZY_MIN_CHARS = 4
_LIKE_ESCAPE = "\\"


def normalize_query(raw: str | None) -> str:
    """Trim, collapse whitespace, strip NULs, cap length. Case and accents are
    left alone: the database normalises both sides identically."""
    text = " ".join((raw or "").replace("\x00", " ").split())
    return text[:MAX_QUERY_LENGTH].strip()


def _escape_like(value: str) -> str:
    return (
        value.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", _LIKE_ESCAPE + "%")
        .replace("_", _LIKE_ESCAPE + "_")
    )


@dataclass(frozen=True, slots=True)
class SearchTerms:
    """Bound SQL expressions for one normalised query."""

    query: str
    needle: ColumnElement       # immutable_unaccent(lower(:q)) — for similarity/ranking
    like_needle: ColumnElement  # same, with LIKE metacharacters escaped
    fuzzy: bool

    def match(self, corpus: ColumnElement) -> ColumnElement:
        """WHERE clause: substring hit, plus word-similarity hit for longer queries."""
        clause = corpus.like(func.concat("%", self.like_needle, "%"), escape=_LIKE_ESCAPE)
        if self.fuzzy:
            clause = or_(clause, self.needle.op("<%")(corpus))
        return clause

    def rank(self, corpus: ColumnElement) -> ColumnElement:
        """0 = prefix, 1 = word start, 2 = substring, 3 = fuzzy only."""
        return case(
            (corpus.like(func.concat(self.like_needle, "%"), escape=_LIKE_ESCAPE), 0),
            (corpus.like(func.concat("% ", self.like_needle, "%"), escape=_LIKE_ESCAPE), 1),
            (corpus.like(func.concat("%", self.like_needle, "%"), escape=_LIKE_ESCAPE), 2),
            else_=3,
        )

    def similarity(self, corpus: ColumnElement) -> ColumnElement:
        """pg_trgm word similarity in [0, 1]; higher is closer."""
        return func.word_similarity(self.needle, corpus)


def search_terms(query: str) -> SearchTerms:
    """Build the bound expressions for an already-normalised, non-empty query."""
    return SearchTerms(
        query=query,
        needle=func.immutable_unaccent(func.lower(literal(query))),
        like_needle=func.immutable_unaccent(func.lower(literal(_escape_like(query)))),
        fuzzy=len(query) >= FUZZY_MIN_CHARS,
    )
