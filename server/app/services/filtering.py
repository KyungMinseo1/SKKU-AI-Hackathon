import re
from collections.abc import Iterable
from pathlib import Path

ALLOWLIST = ("시발점", "시발역")
_STRIP_RE = re.compile(r"[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ\u1100-\u11ff]")


def normalize(s: str) -> str:
    """소문자화 후 한글/영문/숫자/자모 외 문자와 공백 제거."""
    return _STRIP_RE.sub("", s.lower())


def _load_builtin() -> tuple[str, ...]:
    path = Path(__file__).resolve().parent.parent / "ai" / "banned_words_ko.txt"
    words = (line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    return tuple(w for w in words if w)


BUILTIN_WORDS: tuple[str, ...] = _load_builtin()


def find_banned(text: str, course_words: Iterable[str] = ()) -> str | None:
    s = normalize(text)
    for allowed in ALLOWLIST:
        s = s.replace(allowed, "")
    if not s:
        return None
    for word in (*BUILTIN_WORDS, *course_words):
        nw = normalize(word)
        if nw and nw in s:
            return word
    return None
