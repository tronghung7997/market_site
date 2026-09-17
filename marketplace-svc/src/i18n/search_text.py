"""SQL building blocks for diacritic-insensitive, typo-tolerant text search.

Every searchable corpus (``products.search_text``, ``categories.search_text``,
``immutable_unaccent(lower(seller_applications.business_name))``) is stored
lower-cased and unaccented by PostgreSQL. The user's query goes through the
*same* database function, so "Tài Khoản", "tai khoan" and "TAI KHOAN" all
become ``tai khoan`` on both sides and the comparison is exact.

A query is matched two ways, both served by the GIN ``gin_trgm_ops`` index:

1. as one phrase — substring ``LIKE '%needle%'`` plus ``needle <% corpus``
   (pg_trgm word similarity) for typo tolerance from ``FUZZY_MIN_CHARS``;
2. as a bag of words — every token must appear somewhere in the corpus, in
   any order, where each token may be any of its synonyms ("fb" ⇒ "facebook").

Ranking: phrase prefix < phrase at a word start < phrase substring < every
token present < fuzzy only < no match in this corpus. Callers rank the most
specific corpus first (a product's own titles) and the widest one second, then
append popularity tie-breakers.

Synonyms are a process-wide snapshot (``set_synonyms``) refreshed by the
search service from ``search_synonyms``; terms are folded with ``fold`` so a
query token compares the same way PostgreSQL folds the corpus.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from sqlalchemy import ColumnElement, and_, case, func, literal, or_

MAX_QUERY_LENGTH = 80
FUZZY_MIN_CHARS = 4
MAX_TOKENS = 6
# Tokens shorter than this only match whole words ("ip" must not hit "vip").
WORD_MATCH_MAX_CHARS = 2
_LIKE_ESCAPE = "\\"

_synonyms: dict[str, tuple[str, ...]] = {}


def set_synonyms(groups: dict[str, tuple[str, ...]]) -> None:
    """Install the term -> alternatives map (all folded). Empty map disables expansion."""
    global _synonyms
    _synonyms = groups


def fold(text: str) -> str:
    """Python twin of ``immutable_unaccent(lower(...))`` for comparing query
    tokens against synonym terms. Handles đ/Đ, which NFD alone does not."""
    lowered = text.casefold().replace("đ", "d")
    decomposed = unicodedata.normalize("NFD", lowered)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


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


def tokenize(query: str) -> list[tuple[str, ...]]:
    """Split a normalised query into tokens, each expanded to its synonym
    alternatives (folded). Two adjacent words that form a known multi-word
    term ("tai khoan", "ip v4") are merged into one token first."""
    words = [fold(word) for word in query.split(" ") if word]
    tokens: list[tuple[str, ...]] = []
    i = 0
    while i < len(words) and len(tokens) < MAX_TOKENS:
        pair = f"{words[i]} {words[i + 1]}" if i + 1 < len(words) else None
        if pair is not None and pair in _synonyms:
            tokens.append(_synonyms[pair])
            i += 2
            continue
        word = words[i]
        tokens.append(_synonyms.get(word, (word,)))
        i += 1
    # Drop exact duplicates while keeping order.
    seen: set[tuple[str, ...]] = set()
    return [t for t in tokens if not (t in seen or seen.add(t))]


def _like(corpus: ColumnElement, pattern: str) -> ColumnElement:
    return corpus.like(pattern, escape=_LIKE_ESCAPE)


@dataclass(frozen=True, slots=True)
class SearchTerms:
    """Bound SQL expressions for one normalised query."""

    query: str
    needle: ColumnElement       # immutable_unaccent(lower(:q)) — for similarity/ranking
    like_needle: ColumnElement  # same, with LIKE metacharacters escaped
    fuzzy: bool
    tokens: tuple[tuple[str, ...], ...]  # folded alternatives per token

    @property
    def bag_of_words(self) -> bool:
        """True when the token clause adds anything beyond the phrase clause."""
        return len(self.tokens) > 1 or any(len(alts) > 1 for alts in self.tokens)

    def _token_clause(self, corpus: ColumnElement, *, fuzzy: bool) -> ColumnElement:
        parts = []
        padded = func.concat(" ", corpus, " ")
        for alternatives in self.tokens:
            options = [
                _like(padded, f"% {_escape_like(alt)} %") if len(alt) <= WORD_MATCH_MAX_CHARS
                else _like(corpus, f"%{_escape_like(alt)}%")
                for alt in alternatives
            ]
            if fuzzy:
                options.extend(
                    literal(alt).op("<%")(corpus) for alt in alternatives if len(alt) >= FUZZY_MIN_CHARS
                )
            parts.append(or_(*options))
        return and_(*parts)

    def match(self, corpus: ColumnElement) -> ColumnElement:
        """WHERE clause: phrase hit (substring / fuzzy) or every token present."""
        clause = _like(corpus, func.concat("%", self.like_needle, "%"))
        if self.fuzzy:
            clause = or_(clause, self.needle.op("<%")(corpus))
        if self.bag_of_words:
            clause = or_(clause, self._token_clause(corpus, fuzzy=True))
        return clause

    def rank(self, corpus: ColumnElement) -> ColumnElement:
        """0 = prefix, 1 = word start, 2 = substring, 3 = all tokens, 4 = fuzzy,
        5 = this corpus does not match (the row matched through another one)."""
        tiers = [
            (_like(corpus, func.concat(self.like_needle, "%")), 0),
            (_like(corpus, func.concat("% ", self.like_needle, "%")), 1),
            (_like(corpus, func.concat("%", self.like_needle, "%")), 2),
        ]
        if self.bag_of_words:
            tiers.append((self._token_clause(corpus, fuzzy=False), 3))
        if self.fuzzy or self.bag_of_words:
            fuzzy = [self.needle.op("<%")(corpus)] if self.fuzzy else []
            if self.bag_of_words:
                fuzzy.append(self._token_clause(corpus, fuzzy=True))
            tiers.append((or_(*fuzzy), 4))
        return case(*tiers, else_=5)

    def similarity(self, corpus: ColumnElement) -> ColumnElement:
        """pg_trgm word similarity in [0, 1]; higher is closer."""
        return func.word_similarity(self.needle, corpus)


def search_terms(query: str) -> SearchTerms:
    """Build the bound expressions for an already-normalised, non-empty query."""
    return SearchTerms(
        query=query,
        needle=func.immutable_unaccent(func.lower(literal(query))),
        like_needle=func.immutable_unaccent(func.lower(literal(_escape_like(query)))),
        # Phrase-level fuzziness only for a single word: word_similarity of a
        # multi-word needle happily matches any one of its words, which would
        # let "facebook 2015" hit anything mentioning facebook. Multi-word
        # queries get per-token fuzziness through the bag-of-words clause.
        fuzzy=len(query) >= FUZZY_MIN_CHARS and " " not in query,
        tokens=tuple(tokenize(query)),
    )
