import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import collect  # noqa: E402

RSS_SAMPLE = b"""<?xml version="1.0"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test</title>
    <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>
    <item>
      <title>NIST finalises FIPS 203 for ML-KEM</title>
      <link>https://example.com/a1</link>
      <description>&lt;p&gt;Post-quantum key encapsulation&lt;/p&gt;</description>
      <pubDate>Tue, 14 Oct 2026 09:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Falcon 9 launches satellites</title>
      <link>https://example.com/a2</link>
      <description>Rocket news</description>
      <pubDate>Mon, 13 Oct 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
"""

ATOM_SAMPLE = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>QKD network deployed</title>
    <link rel="alternate" href="https://example.com/b1"/>
    <link rel="self" href="https://example.com/feed"/>
    <summary>Quantum key distribution over fibre</summary>
    <updated>2026-10-12T10:00:00Z</updated>
  </entry>
</feed>
"""


class MatchThemesTests(unittest.TestCase):
    def test_pqc_detected(self):
        self.assertIn("PQC", collect.match_themes("NIST finalises FIPS 203 for ML-KEM"))

    def test_qkd_detected(self):
        self.assertIn("QKD", collect.match_themes("New quantum key distribution link"))

    def test_quantum_threat_detected(self):
        themes = collect.match_themes("Researchers estimate when a quantum computer could break RSA")
        self.assertIn("Menace quantique", themes)

    def test_unrelated_article_rejected(self):
        self.assertEqual(collect.match_themes("Falcon 9 launches satellites"), [])

    def test_most_relevant_theme_first(self):
        themes = collect.match_themes("PQC migration: post-quantum ML-KEM, ML-DSA and QKD pilots")
        self.assertEqual(themes[0], "PQC")


class FrenchKeywordTests(unittest.TestCase):
    def test_post_quantum_french(self):
        themes = collect.match_themes("L'ANSSI publie ses recommandations pour la cryptographie post-quantique")
        self.assertIn("PQC", themes)
        self.assertIn("Normes & politiques", themes)

    def test_threat_french(self):
        self.assertIn("Menace quantique", collect.match_themes("Un ordinateur quantique pourrait casser le chiffrement RSA"))

    def test_qkd_french(self):
        self.assertIn("QKD", collect.match_themes("Distribution quantique de clés : un réseau déployé à Paris"))

    def test_quantum_computing_alone_is_not_enough(self):
        self.assertEqual(collect.match_themes("Informatique quantique : une nouvelle puce de 100 qubits"), [])

    def test_unrelated_french_article(self):
        self.assertEqual(collect.match_themes("Le gouvernement présente son budget pour la cybersécurité des hôpitaux"), [])


class LanguageTests(unittest.TestCase):
    def collect_one(self, source):
        entry = {"title": "Cryptographie post-quantique : l'ANSSI publie ses recommandations", "url": "https://example.fr/a", "summary": "", "date": None, "image": None}
        original = collect.fetch_entries
        collect.fetch_entries = lambda _source: [entry]
        try:
            articles, _ = collect.collect([source], dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc))
        finally:
            collect.fetch_entries = original
        return articles[0]

    def test_french_source_marks_articles_as_french(self):
        self.assertEqual(self.collect_one({"name": "S", "url": "u", "lang": "fr"})["lang"], "fr")

    def test_language_defaults_to_english(self):
        entry = {"title": "Post-quantum cryptography: NIST publishes new recommendations", "url": "https://example.com/a", "summary": "", "date": None, "image": None}
        original = collect.fetch_entries
        collect.fetch_entries = lambda _source: [entry]
        try:
            articles, _ = collect.collect([{"name": "S", "url": "u"}], dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc))
        finally:
            collect.fetch_entries = original
        self.assertEqual(articles[0]["lang"], "en")


SITEMAP_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://cyber.example.fr/</loc><lastmod>2026-10-20</lastmod></url>
  <url><loc>https://cyber.example.fr/actualites/</loc><lastmod>2025-11-26</lastmod></url>
  <url><loc>https://cyber.example.fr/actualites/transition-post-quantique-lanssi-et-ses-partenaires-du-g7-publient-un-appel-a-action/</loc><lastmod>2026-09-03</lastmod></url>
  <url><loc>https://cyber.example.fr/actualites/l%27algorithme-haetae-laur%C3%A9at-de-la-comp%C3%A9tition-de-cryptographie-post-quantique/</loc><lastmod>2025-12-03</lastmod></url>
  <url><loc>https://cyber.example.fr/mentions-legales/</loc><lastmod>2026-09-21</lastmod></url>
</urlset>""".encode("utf-8")


class DetectLangTests(unittest.TestCase):
    def test_english_title_on_french_source_is_english(self):
        self.assertEqual(collect.detect_lang("Position paper on quantum key distribution", "fr"), "en")
        self.assertEqual(collect.detect_lang("A coordinated implementation roadmap for the transition to post-quantum cryptography", "fr"), "en")

    def test_french_title_on_french_source_stays_french(self):
        self.assertEqual(collect.detect_lang("La distribution quantique de clé, son utilisation et ses limites", "fr"), "fr")
        self.assertEqual(collect.detect_lang("Cryptographie post-quantique", "fr"), "fr")

    def test_french_title_on_english_source_is_french(self):
        self.assertEqual(collect.detect_lang("Comment le Crédit Agricole amorce sa mue post-quantique dans la banque", "en"), "fr")

    def test_ambiguous_title_keeps_the_source_language(self):
        self.assertEqual(collect.detect_lang("Kyber ML-KEM", "en"), "en")
        self.assertEqual(collect.detect_lang("Kyber ML-KEM", "fr"), "fr")


class SitemapTests(unittest.TestCase):
    def test_slug_fixes_hyphen_and_elision(self):
        url = "https://x.fr/actualites/lalgorithme-haetae-laureat-de-la-competition-de-cryptographie-post-quantique/"
        title = collect._title_from_slug(url)
        self.assertTrue(title.startswith("L'algorithme haetae"))
        self.assertTrue(title.endswith("post-quantique"))

    def test_keeps_only_pages_matching_the_pattern(self):
        entries = collect.parse_sitemap(SITEMAP_SAMPLE, r"/actualites/.+")
        self.assertEqual(len(entries), 2)

    def test_title_is_derived_from_the_address(self):
        entries = collect.parse_sitemap(SITEMAP_SAMPLE, r"/actualites/.+")
        self.assertEqual(entries[0]["title"], "Transition post-quantique L'ANSSI et ses partenaires du G7 publient un appel a action")
        self.assertIn("algorithme haetae lauréat", entries[1]["title"])

    def test_date_comes_from_lastmod(self):
        entries = collect.parse_sitemap(SITEMAP_SAMPLE, r"/actualites/.+")
        self.assertEqual(entries[0]["date"], dt.datetime(2026, 9, 3, tzinfo=dt.timezone.utc))

    def test_french_keywords_apply_to_derived_titles(self):
        entries = collect.parse_sitemap(SITEMAP_SAMPLE, r"/actualites/.+")
        self.assertTrue(all(collect.match_themes(e["title"]) for e in entries))


class ParseFeedTests(unittest.TestCase):
    def test_rss(self):
        entries = collect.parse_feed(RSS_SAMPLE)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["url"], "https://example.com/a1")
        self.assertEqual(entries[0]["summary"], "Post-quantum key encapsulation")
        self.assertEqual(entries[0]["date"], dt.datetime(2026, 10, 14, 9, 30, tzinfo=dt.timezone.utc))

    def test_atom_uses_alternate_link(self):
        entries = collect.parse_feed(ATOM_SAMPLE)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["url"], "https://example.com/b1")
        self.assertEqual(entries[0]["date"].hour, 10)


HTML_SAMPLE = """<html><body>
  <nav><a href="/">Accueil</a></nav>
  <a href="/newsroom/press-releases/etsi-launches-quantum-safe-standard">ETSI launches quantum-safe standard</a>
  <a href="/newsroom/press-releases/etsi-launches-quantum-safe-standard">Doublon du même lien long</a>
  <a href="/newsroom/press-releases/">Liste des communiqués de presse</a>
  <a href="/topics/quantum">Voir le sujet quantique complet</a>
  <a href="/newsroom/press-releases/short"></a>
</body></html>"""


class ScrapeTests(unittest.TestCase):
    def test_keeps_matching_article_links_only(self):
        entries = collect.parse_listing(
            HTML_SAMPLE,
            "https://www.etsi.org/newsroom/press-releases",
            r"/newsroom/press-releases/[^/]+/?$",
        )
        self.assertEqual(
            [e["url"] for e in entries],
            ["https://www.etsi.org/newsroom/press-releases/etsi-launches-quantum-safe-standard"],
        )
        self.assertIsNone(entries[0]["date"])

    def test_date_extracted_from_title(self):
        page = '<a href="/news/a1">SPOTLIGHT ARTICLE | 13/10/2026 | Ben PackmanWhy perfect crypto inventory stalls</a>'
        entries = collect.parse_listing(page, "https://example.org/", r"/news/")
        self.assertEqual(entries[0]["date"], dt.datetime(2026, 10, 13, tzinfo=dt.timezone.utc))
        self.assertNotIn("13/10/2026", entries[0]["title"])

    def test_title_is_cleaned_of_soft_hyphens(self):
        page = '<a href="/news/post-quantum-m­igration-guide">Post­-quantum migration guide 2026</a>'
        entries = collect.parse_listing(page, "https://example.org/", r"/news/")
        self.assertEqual(entries[0]["title"], "Post-quantum migration guide 2026")


class MergeTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 10, 19, 12, 0, tzinfo=dt.timezone.utc)

    def article(self, url, date, title="t"):
        return {
            "id": collect.article_id(url), "title": title, "url": url, "summary": "",
            "source": "s", "category": "c", "themes": ["PQC"], "date": date,
            "first_seen": date,
        }

    def test_deduplicates_and_keeps_first_seen(self):
        old = self.article("https://x.org/1", "2026-10-01T00:00:00Z", title="ancien")
        new = self.article("https://x.org/1", "2026-10-01T00:00:00Z", title="nouveau")
        new["first_seen"] = "2026-10-19T12:00:00Z"
        merged = collect.merge([old], [new], self.now)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["title"], "nouveau")
        self.assertEqual(merged[0]["first_seen"], "2026-10-01T00:00:00Z")

    def test_drops_articles_past_retention(self):
        ancient = self.article("https://x.org/old", "2020-01-01T00:00:00Z")
        recent = self.article("https://x.org/new", "2026-10-10T00:00:00Z")
        merged = collect.merge([ancient], [recent], self.now)
        self.assertEqual([a["url"] for a in merged], ["https://x.org/new"])

    def test_sorted_by_date_desc(self):
        a = self.article("https://x.org/a", "2026-10-01T00:00:00Z")
        b = self.article("https://x.org/b", "2026-10-05T00:00:00Z")
        merged = collect.merge([a], [b], self.now)
        self.assertEqual([x["url"] for x in merged], ["https://x.org/b", "https://x.org/a"])


RSS_IMAGES = b"""<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <item><title>Media content</title><link>https://example.com/m</link>
      <media:content url="https://cdn.example.com/photos/cover.jpg" medium="image"/></item>
    <item><title>Enclosure</title><link>https://example.com/e</link>
      <enclosure url="/uploads/pic.png" type="image/png" length="1"/></item>
    <item><title>Image dans le texte</title><link>https://example.com/h</link>
      <description>&lt;p&gt;&lt;img src="https://cdn.example.com/a/b.webp?w=800&amp;amp;h=600"&gt; texte&lt;/p&gt;</description></item>
    <item><title>Logo ignore</title><link>https://example.com/l</link>
      <description>&lt;img src="https://example.com/images/site-logo.png"&gt;</description></item>
    <item><title>Pixel de suivi ignore</title><link>https://example.com/p</link>
      <description>&lt;img src="https://stats.example.com/pixel.gif"&gt;</description></item>
    <item><title>Aucune image</title><link>https://example.com/n</link><description>Rien</description></item>
  </channel>
</rss>
"""


class ImageTests(unittest.TestCase):
    def setUp(self):
        self.by_title = {e["title"]: e["image"] for e in collect.parse_feed(RSS_IMAGES, "https://example.com/feed.xml")}

    def test_media_content(self):
        self.assertEqual(self.by_title["Media content"], "https://cdn.example.com/photos/cover.jpg")

    def test_enclosure_relative_url_is_resolved(self):
        self.assertEqual(self.by_title["Enclosure"], "https://example.com/uploads/pic.png")

    def test_image_in_html_text_is_unescaped(self):
        self.assertEqual(self.by_title["Image dans le texte"], "https://cdn.example.com/a/b.webp?w=800&h=600")

    def test_logos_and_tracking_pixels_are_ignored(self):
        self.assertIsNone(self.by_title["Logo ignore"])
        self.assertIsNone(self.by_title["Pixel de suivi ignore"])

    def test_no_image(self):
        self.assertIsNone(self.by_title["Aucune image"])

    def test_og_image_both_attribute_orders(self):
        a = '<meta property="og:image" content="https://cdn.example.com/social/a.jpg">'
        b = '<meta content="/img/b.png" property="og:image" />'
        self.assertEqual(collect.og_image(a, "https://example.com/x"), "https://cdn.example.com/social/a.jpg")
        self.assertEqual(collect.og_image(b, "https://example.com/x"), "https://example.com/img/b.png")

    def test_og_image_generic_logo_is_rejected(self):
        page = '<meta property="og:image" content="https://example.com/static/site-logo.png">'
        self.assertIsNone(collect.og_image(page, "https://example.com/x"))

    def test_merge_keeps_previous_image(self):
        now = dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc)
        old = {"id": "1", "title": "t", "url": "u", "summary": "", "source": "s", "category": "c", "themes": ["PQC"],
               "date": "2026-10-19T00:00:00Z", "first_seen": "2026-10-19T00:00:00Z", "image": "https://x.org/a.jpg"}
        new = {k: v for k, v in old.items() if k != "image"}
        self.assertEqual(collect.merge([old], [new], now)[0]["image"], "https://x.org/a.jpg")


if __name__ == "__main__":
    unittest.main()
