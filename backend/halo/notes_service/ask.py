"""Ask across meetings: keyword retrieval over stored passages, then one Spark answer.

No embeddings: an embedding model would be one more runtime model (and it must
be Meta's). Instead Spark rewrites the question into English + Arabic keywords
(so an Arabic question finds English meetings and back), passages are scored by
keyword hits, and Spark answers from the top ones, citing passage numbers. The
quotes shown come from the store, never from the model.
ponytail: a linear scan of every passage; fine for hundreds of meetings, move
to the FTS5 index if a library grows past that.
"""

from __future__ import annotations

import re
from typing import Any

TOP_N = 24
MAX_CHARS = 6000
SCOPE_WEIGHT = {"summary": 1.5, "action": 1.4, "point": 1.3, "transcript": 1.0}

TERMS_SCHEMA = {
    "type": "object",
    "properties": {"terms": {"type": "array", "maxItems": 16,
                             "items": {"type": "string", "maxLength": 40}}},
    "required": ["terms"], "additionalProperties": False,
}
ANSWER_SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string", "maxLength": 900},
                   "cites": {"type": "array", "maxItems": 6, "items": {"type": "integer"}}},
    "required": ["answer", "cites"], "additionalProperties": False,
}
TERMS_PROMPT = (
    "Turn this question about past meetings into search keywords. Give 4 to 12 "
    "single words: the key nouns, names and verbs, each in English AND in Arabic, "
    "plus close variants (decide, decision, decided). No stop words. Reply as JSON.\n"
    "Question: {q}"
)
ANSWER_PROMPT = (
    "You answer questions about the user's past meetings, using ONLY the numbered "
    "passages below (each: date, meeting, speaker, kind, words). Answer in at most 4 "
    "short sentences, in the language of the question. Name who said or owns what, "
    "and the meeting date when it helps. If the passages do not answer it, say so "
    "plainly; never guess. cites: the numbers of the passages you used, most "
    "important first. Reply as JSON.\n\nQuestion: {q}\n\nPassages:\n{passages}"
)
NOTHING = {"en": "Nothing in your meetings mentions that yet.",
           "ar": "لا يوجد شيء عن هذا في اجتماعاتك حتى الآن."}
FAILED = {"en": "The model did not answer. Try again in a moment.",
          "ar": "لم يُجب النموذج. حاول مرة أخرى بعد قليل."}

_STOP_WORDS = (
    "a an the and or of to in on at for by with from is are was were be been do does did "
    "what when where who whom which why how we our us you your they them it this that "
    "about any there have has had will would can could should please tell me "
    "في من على عن ما ماذا متى من هل مع الى إلى انا احنا نحن شو ايش اللي الذي التي هذا هذه كان")
_DIACRITICS = re.compile("[ً-ْـ]")
_ALEF = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي"})


def lang_of(text: str) -> str:
    return "ar" if any("؀" <= c <= "ۿ" for c in text) else "en"


def norm(word: str) -> str:
    """Lowercase; Arabic without diacritics, one alef, and no leading article."""
    w = _DIACRITICS.sub("", word.lower()).translate(_ALEF)
    for prefix in ("وال", "بال", "فال", "لل", "ال"):
        if w.startswith(prefix) and len(w) - len(prefix) >= 3:
            return w[len(prefix):]
    return w


STOP = {norm(w) for w in _STOP_WORDS.split()}


def tokens(text: str) -> set[str]:
    return {t for t in (norm(w) for w in re.findall(r"\w+", text)) if len(t) > 1 and t not in STOP}


def _hit(term: str, toks: set[str]) -> bool:
    if term in toks:
        return True
    # A shared stem: "decide"/"decided", "signup"/"signups" (both words >= 4 letters).
    return len(term) >= 4 and any(len(t) >= 4 and (t.startswith(term) or term.startswith(t)) for t in toks)


def score(text: str, terms: list[str]) -> int:
    toks = tokens(text)
    return sum(_hit(t, toks) for t in terms)


def _terms(llm: Any, question: str) -> list[str]:
    words = set(tokens(question))
    result = llm.complete_json(prompt=TERMS_PROMPT.format(q=question), schema=TERMS_SCHEMA,
                               schema_name="ask.terms", prompt_cache_key="halo-ask-terms")
    if result is not None and result.ok and isinstance(result.data, dict):
        for term in result.data.get("terms", []):
            words |= tokens(str(term))
    return sorted(words)


def answer(llm: Any, question: str, passages: list[dict[str, Any]]) -> dict[str, Any]:
    """{answer, citations (store passages), engine} or {error, answer, citations: []}."""
    lang = lang_of(question)
    terms = _terms(llm, question)
    ranked = sorted(
        ((score(p["snippet"], terms) * SCOPE_WEIGHT.get(p.get("scope", ""), 1.0), -i, p)
         for i, p in enumerate(passages)),
        key=lambda r: (r[0], r[1]), reverse=True)
    picked: list[dict[str, Any]] = []
    used = 0
    for weight, _, p in ranked:
        if weight <= 0 or len(picked) >= TOP_N:
            break
        if used + len(p["snippet"]) > MAX_CHARS:
            continue
        picked.append(p)
        used += len(p["snippet"])
    if not picked:
        return {"answer": NOTHING[lang], "citations": [], "engine": None}
    numbered = "\n".join(
        f"[{n}] {p.get('date', '')} | {p.get('subject', '')} | {p.get('speaker') or '-'} | "
        f"{p.get('kind') or p.get('scope', '')}: {p['snippet']}" for n, p in enumerate(picked, start=1))
    result = llm.complete_json(prompt=ANSWER_PROMPT.format(q=question, passages=numbered),
                               schema=ANSWER_SCHEMA, schema_name="ask.answer")
    if result is None or not result.ok or not isinstance(result.data, dict):
        return {"error": "model_failed", "answer": FAILED[lang], "citations": []}
    seen: set[int] = set()
    citations = []
    for n in result.data.get("cites", []):
        if isinstance(n, int) and 1 <= n <= len(picked) and n not in seen:
            seen.add(n)
            citations.append(picked[n - 1])
    return {"answer": str(result.data.get("answer", "")).strip(), "citations": citations,
            "engine": result.engine}
