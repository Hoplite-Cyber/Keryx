#!/usr/bin/env python3
"""Collecte les flux RSS/Atom de sources spécialisées et ne garde que les articles
liés à la cryptographie post-quantique (PQC), à la QKD et à la menace quantique.

Aucune dépendance externe : bibliothèque standard uniquement.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCES = ROOT / "sources.json"
DEFAULT_OUT = ROOT / "site" / "data" / "articles.json"

# Certains éditeurs (NIST, Cloudflare...) renvoient 403 à tout UA non navigateur :
# on utilise donc un UA de navigateur classique, comme la plupart des lecteurs RSS.
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
TIMEOUT = 25  # secondes par source
MAX_ARTICLES = 2000  # plafond du fichier de données
RETENTION_DAYS = 730  # on conserve deux ans d'historique
SUMMARY_LENGTH = 350
MIN_TITLE_LENGTH = 20  # écarte les liens de navigation (« Accueil », « Lire la suite »…)
LISTING_DATE_RE = re.compile(r"(?<!\d)(\d{2})/(\d{2})/(\d{4})(?!\d)")
# Images d'articles : on ne garde que l'adresse (rien n'est téléchargé ni copié).
IMG_IN_HTML_RE = re.compile(r"""<img[^>]+src=["']([^"']+)""", re.IGNORECASE)
OG_IMAGE_RE = re.compile(
    r"""<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)|<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']""",
    re.IGNORECASE,
)
GENERIC_IMAGE_RE = re.compile(r"logo|icon|avatar|pixel|spacer|1x1|feedburner|gravatar|emoji|badge|\.gif", re.IGNORECASE)
IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|webp)(\?|$)|/image|image\.", re.IGNORECASE)

# Thèmes et motifs de détection. Un article est retenu s'il matche au moins un motif
# (sauf les sources marquées "all": true, dédiées au sujet).
THEMES: dict[str, list[str]] = {
    "PQC": [
        r"post[- ]quantum",
        r"\bPQC\b",
        r"quantum[- ](safe|resistant|secure|proof)",
        r"\bML-KEM\b",
        r"\bML-DSA\b",
        r"\bSLH-DSA\b",
        r"\bFN-DSA\b",
        r"\bHQC\b",
        r"\bFIPS[ -]20[345]\b",
        r"CRYSTALS-(Kyber|Dilithium)",
        r"\bKyber(512|768|1024)\b",
        r"\bDilithium\b",
        r"\bSPHINCS\+?",
        r"Falcon-?(512|1024)",
        r"lattice[- ]based (cryptograph|encryption|key|signature)",
        r"crypto[- ]?agil",
        r"harvest[- ]now[- ]decrypt[- ]later",
        r"store[- ]now[- ](decrypt|break)",
        # français
        r"post[- ]quantiques?",
        r"résistant\w*\s+(au|aux|à l[ae']?)\s*(calcul |ordinateurs? )?quantiques?",
        r"agilité cryptographique",
        r"(récolter|collecter|stocker) maintenant[, ]+déchiffrer",
    ],
    "QKD": [
        r"\bQKD\b",
        r"quantum[- ]key[- ]distribution",
        r"quantum cryptograph",
        r"quantum[- ]secure (communication|network)",
        r"\bBB84\b",
        r"quantum[- ]random(ness)?\b",
        r"quantum internet",
        # français
        r"distribution quantique de cl[ée]s?",
        r"cryptographie quantique",
        r"communications? quantiques? s[ée]curis\w+",
        r"internet quantique",
    ],
    "Menace quantique": [
        r"shor'?s? algorithm",
        r"cryptographically relevant quantum",
        r"\bCRQC\b",
        r"\bQ-Day\b",
        r"break(ing)? (RSA|ECC|elliptic)",
        r"quantum.{0,120}(encrypt|cryptograph|decrypt)",
        r"(encrypt|cryptograph|decrypt).{0,120}quantum",
        # français
        r"menace quantique",
        r"algorithme de shor",
        r"quantiques?.{0,120}(chiffr|cryptograph|déchiffr)",
        r"(chiffr|cryptograph|déchiffr)\w*.{0,120}quantiques?",
    ],
    "Normes & politiques": [
        r"\bNIST\b.{0,200}\b(quantum|PQC)",
        r"\b(quantum|PQC).{0,200}\bNIST\b",
        r"\bCNSA ?2\.0\b",
        r"\b(ANSSI|ENISA|NCSC|BSI|ETSI|IETF|NSA)\b.{0,200}quantum",
        r"quantum.{0,200}\b(ANSSI|ENISA|NCSC|BSI|ETSI|IETF|NSA)\b",
        r"migration to post",
        # français
        r"\b(ANSSI|ENISA|NCSC|BSI|ETSI|IETF|NSA|NIST)\b.{0,200}quantiques?",
        r"quantiques?.{0,200}\b(ANSSI|ENISA|NCSC|BSI|ETSI|IETF|NSA|NIST)\b",
        r"migration (vers|à) (la )?(cryptographie )?post",
    ],
}
COMPILED = {
    theme: [re.compile(p, re.IGNORECASE) for p in patterns]
    for theme, patterns in THEMES.items()
}

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")
# Préfixe ajouté par les flux arXiv : « arXiv:2610.23654v1 Announce Type: new Abstract: ».
ARXIV_PREFIX_RE = re.compile(r"^arXiv:\S+\s+Announce Type:\s*\S+\s+Abstract:\s*", re.IGNORECASE)


def match_themes(text: str) -> list[str]:
    """Renvoie les thèmes détectés, du plus pertinent (plus de motifs trouvés) au moins pertinent."""
    hits = {}
    for theme, patterns in COMPILED.items():
        count = sum(len(p.findall(text)) for p in patterns)
        if count:
            hits[theme] = count
    return sorted(hits, key=lambda t: hits[t], reverse=True)


def _local(tag: str) -> str:
    """Nom de balise sans espace de noms (`{ns}title` -> `title`)."""
    return tag.rsplit("}", 1)[-1]


def _clean(text: str) -> str:
    """Retire le HTML éventuel, normalise Unicode (ligatures PDF) et les espaces."""
    text = unicodedata.normalize("NFKC", html.unescape(TAG_RE.sub(" ", text))).replace("­", "")
    return WS_RE.sub(" ", text).strip()


def _child_text(el: ET.Element, *names: str) -> str:
    for child in el:
        if _local(child.tag) in names and child.text and child.text.strip():
            return child.text.strip()
    return ""


def _atom_link(el: ET.Element) -> str:
    for child in el:
        if _local(child.tag) == "link" and child.get("href") and child.get("rel", "alternate") == "alternate":
            return child.get("href", "")
    return ""


def _parse_date(raw: str) -> dt.datetime | None:
    if not raw:
        return None
    raw = raw.strip()
    try:
        date = parsedate_to_datetime(raw)  # RFC 822 (RSS)
    except Exception:
        try:
            date = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))  # ISO 8601 (Atom)
        except ValueError:
            return None
    if date.tzinfo is None:
        date = date.replace(tzinfo=dt.timezone.utc)
    return date.astimezone(dt.timezone.utc)


def _truncate(text: str, length: int = SUMMARY_LENGTH) -> str:
    if len(text) <= length:
        return text
    cut = text[:length].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:") + "…"


def _iso(date: dt.datetime) -> str:
    return date.strftime("%Y-%m-%dT%H:%M:%SZ")


def _usable_image(url: str) -> bool:
    """Une vraie image d'article : ni logo, ni pixel de suivi, ni icône ; format courant."""
    return bool(url) and url.startswith(("http://", "https://")) and not GENERIC_IMAGE_RE.search(url) and bool(IMAGE_EXT_RE.search(url))


def _entry_image(el: ET.Element, base_url: str) -> str | None:
    """Cherche l'image d'une entrée : media:content / media:thumbnail, enclosure, puis première <img> du texte."""
    for child in el.iter():
        tag = _local(child.tag)
        url = child.get("url") or ""
        # L'espace de noms « media: » s'écrit http://search.yahoo.com/mrss/ dans le XML.
        if tag in ("thumbnail", "content") and ("mrss" in child.tag or "media" in child.tag) and _usable_image(urljoin(base_url, url)):
            return urljoin(base_url, url)
        if tag == "enclosure" and "image" in (child.get("type") or "") and _usable_image(urljoin(base_url, url)):
            return urljoin(base_url, url)
    for child in el.iter():
        if _local(child.tag) in ("encoded", "description", "summary", "content") and child.text:
            for match in IMG_IN_HTML_RE.finditer(child.text):
                candidate = urljoin(base_url, html.unescape(match.group(1)))
                if _usable_image(candidate):
                    return candidate
    return None


def og_image(html_text: str, base_url: str) -> str | None:
    """Image de partage (og:image) d'une page d'article, si c'est une vraie image."""
    match = OG_IMAGE_RE.search(html_text)
    if not match:
        return None
    candidate = urljoin(base_url, html.unescape(match.group(1) or match.group(2)))
    return candidate if _usable_image(candidate) else None


def parse_feed(data: bytes, base_url: str = "") -> list[dict]:
    """Extrait les entrées d'un flux RSS 2.0 ou Atom."""
    root = ET.fromstring(data)
    entries = []
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        title = _clean(_child_text(el, "title"))
        link = _atom_link(el) or _child_text(el, "link", "guid", "id")
        summary = _clean(_child_text(el, "description", "summary", "content", "encoded"))
        summary = ARXIV_PREFIX_RE.sub("", summary)
        date = _parse_date(_child_text(el, "pubDate", "published", "updated", "date"))
        if title and link.startswith(("http://", "https://")):
            entries.append(
                {"title": title, "url": link.strip(), "summary": summary, "date": date, "image": _entry_image(el, base_url)}
            )
    return entries


class _AnchorParser(HTMLParser):
    """Recense les liens (href, texte) d'une page HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            title = _clean("".join(self._text))
            if title:
                self.links.append((self._href.strip(), title))
            self._href = None


def parse_listing(html_text: str, base_url: str, link_pattern: str = r".") -> list[dict]:
    """Extrait les articles d'une page d'actualités : liens dont l'URL matche `link_pattern`.

    Les pages de listing n'ont pas de date fiable en général : la date reste None
    (le collecteur utilise alors la date de première découverte).
    """
    parser = _AnchorParser()
    parser.feed(html_text)
    pattern = re.compile(link_pattern)
    seen, entries = set(), []
    for href, title in parser.links:
        url = urljoin(base_url, href)
        if url in seen or url.rstrip("/") == base_url.rstrip("/") or not pattern.search(url):
            continue
        if len(title) < MIN_TITLE_LENGTH or not url.startswith(("http://", "https://")):
            continue
        seen.add(url)
        date = None
        date_match = LISTING_DATE_RE.search(title)
        if date_match:  # ex. « 13/10/2026 » affiché dans le titre (PQShield)
            day, month, year = map(int, date_match.groups())
            date = dt.datetime(year, month, day, tzinfo=dt.timezone.utc)
            title = _clean(title.replace(date_match.group(0), " "))
        entries.append({"title": title, "url": url, "summary": "", "date": date})
    return entries


_SLUG_FIXES = {
    "anssi": "ANSSI", "pqc": "PQC", "g7": "G7", "qkd": "QKD", "nist": "NIST", "enisa": "ENISA", "ia": "IA",
    "lanssi": "L'ANSSI", "danssi": "d'ANSSI",
}


# Élisions perdues dans les adresses (« l'algorithme » devient « lalgorithme ») : on rétablit les plus courantes.
_ELISIONS = {
    "lalgorithme": "l'algorithme", "loffre": "l'offre", "lécosystème": "l'écosystème", "dune": "d'une", "dun": "d'un",
    "léchelle": "l'échelle", "lunion": "l'Union", "lapproche": "l'approche", "lhorizon": "l'horizon", "linternet": "l'internet",
}


def _title_from_slug(url: str) -> str:
    """Titre lisible déduit de la dernière partie d'une adresse (« …/transition-post-quantique/ »)."""
    slug = unquote(urlparse(url).path.rstrip("/").rsplit("/", 1)[-1])
    words = [_ELISIONS.get(w.lower(), _SLUG_FIXES.get(w.lower(), w)) for w in re.split(r"[-_]+", slug) if w]
    text = " ".join(words).strip()
    text = re.sub(r"\b(post) (quantique|quantum)\b", r"\1-\2", text, flags=re.IGNORECASE)
    return _truncate(text[:1].upper() + text[1:], 180)


# Détection grossière de la langue d'un titre : mots-outils français contre anglais.
# Les mots ambigus (« a », « or », « d », « l » issus d'une apostrophe) sont volontairement absents.
_FR_WORDS = frozenset("le la les de des du et en pour sur dans par au aux un une ou est son ses avec ce cette qui que se sa leur leurs à".split())
_EN_WORDS = frozenset("the of and to for in on an with is are by from this that its their at as be".split())


def detect_lang(text: str, default: str) -> str:
    """Corrige la langue par défaut d'une source quand le titre est dans l'autre langue.

    Source française : un seul mot-outil anglais de plus suffit (les sites français publient parfois des documents en anglais).
    Source anglaise : il faut au moins 2 mots-outils français de plus, pour ne pas confondre un nom propre avec du français.
    """
    words = [w for part in re.findall(r"[a-zàâçéèêëîïôûùüÿœ']+", text.lower()) for w in part.split("'")]
    fr, en = sum(w in _FR_WORDS for w in words), sum(w in _EN_WORDS for w in words)
    if default == "fr" and en > fr:
        return "en"
    if default == "en" and fr >= en + 2:
        return "fr"
    return default


def parse_sitemap(data: bytes, link_pattern: str = ".") -> list[dict]:
    """Extrait les pages d'un plan de site (sitemap.xml) : adresse, date de dernière modification, titre déduit de l'adresse.

    Utile pour les sites sans flux RSS dont les pages sont protégées contre les robots, mais dont le plan de site est public
    (annoncé dans leur robots.txt). La date est celle de la dernière modification de la page.
    """
    root = ET.fromstring(data)
    pattern = re.compile(link_pattern)
    entries = []
    for el in root.iter():
        if _local(el.tag) != "url":
            continue
        loc = _child_text(el, "loc")
        if not loc.startswith(("http://", "https://")) or not pattern.search(loc):
            continue
        title = _title_from_slug(loc)
        if len(title) >= MIN_TITLE_LENGTH:
            entries.append({"title": title, "url": loc, "summary": "", "date": _parse_date(_child_text(el, "lastmod")), "image": None})
    return entries


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/rss+xml, application/atom+xml, text/html;q=0.9, application/xml;q=0.8, */*;q=0.5",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def fetch_entries(source: dict) -> list[dict]:
    """Récupère les entrées d'une source : flux RSS/Atom (défaut) ou page HTML (`"type": "scrape"`)."""
    body = fetch(source["url"])
    if source.get("type") == "sitemap":
        return parse_sitemap(body, source.get("link_pattern", "."))
    if source.get("type", "rss") == "scrape":
        return parse_listing(body.decode("utf-8", errors="replace"), source["url"], source.get("link_pattern", "."))
    return parse_feed(body, source["url"])


def article_id(url: str) -> str:
    return hashlib.sha256(url.rstrip("/").encode("utf-8")).hexdigest()[:16]


def collect(
    sources: list[dict], now: dt.datetime, known_images: dict[str, str] | None = None
) -> tuple[list[dict], list[dict]]:
    """Interroge chaque source. Une source en panne n'interrompt pas les autres.

    `known_images` (id d'article -> adresse d'image) évite de redemander l'image de partage
    des articles déjà traités pour les sources marquées `"og_image": true`.
    """
    known_images = known_images or {}
    articles: list[dict] = []
    report: list[dict] = []
    for source in sources:
        try:
            entries = fetch_entries(source)
        except Exception as exc:
            report.append(
                {
                    "name": source["name"],
                    "category": source.get("category", "Autre"),
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
            print(f"[ERREUR] {source['name']} : {exc}", file=sys.stderr)
            continue

        kept = 0
        for entry in entries:
            themes = match_themes(f"{entry['title']} {entry['summary']}")
            if not themes and not source.get("all"):
                continue
            date = entry["date"] or now
            ident = article_id(entry["url"])
            image = entry.get("image") or known_images.get(ident)
            if not image and source.get("og_image"):  # ex. NIST : pas d'image dans le flux, mais une vraie image de partage
                try:
                    image = og_image(fetch(entry["url"]).decode("utf-8", errors="replace"), entry["url"])
                except Exception:
                    image = None
            article = {
                "id": ident,
                "title": entry["title"],
                "url": entry["url"],
                "summary": _truncate(entry["summary"]),
                "source": source["name"],
                "category": source.get("category", "Autre"),
                "lang": detect_lang(f"{entry['title']} {entry['summary']}", source.get("lang", "en")),
                "themes": themes or ["Général"],
                "date": _iso(date),
                "first_seen": _iso(now),
            }
            if image:
                article["image"] = image
            articles.append(article)
            kept += 1
        report.append(
            {
                "name": source["name"],
                "category": source.get("category", "Autre"),
                "ok": True,
                "fetched": len(entries),
                "kept": kept,
            }
        )
        print(f"[OK] {source['name']} : {len(entries)} entrées, {kept} retenues")
    return articles, report


def merge(existing: list[dict], new: list[dict], now: dt.datetime) -> list[dict]:
    """Fusionne l'historique et les nouveaux articles, dédoublonne et applique la rétention."""
    by_id = {article["id"]: article for article in existing}
    for article in new:
        previous = by_id.get(article["id"])
        if previous:
            article = {**previous, **article, "first_seen": previous.get("first_seen", article["first_seen"])}
        by_id[article["id"]] = article

    cutoff = _iso(now - dt.timedelta(days=RETENTION_DAYS))
    kept = [a for a in by_id.values() if a["date"] >= cutoff]
    kept.sort(key=lambda a: a["date"], reverse=True)
    return kept[:MAX_ARTICLES]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    sources = json.loads(args.sources.read_text(encoding="utf-8"))
    existing = []
    if args.out.exists():
        existing = json.loads(args.out.read_text(encoding="utf-8")).get("articles", [])

    known_images = {a["id"]: a["image"] for a in existing if a.get("image")}
    new_articles, report = collect(sources, now, known_images)
    if not any(r["ok"] for r in report):
        print("Aucune source joignable : fichier de données non modifié.", file=sys.stderr)
        return 1

    articles = merge(existing, new_articles, now)
    payload = {
        "generated_at": _iso(now),
        "count": len(articles),
        "sources": report,
        "articles": articles,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(articles)} articles écrits dans {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
