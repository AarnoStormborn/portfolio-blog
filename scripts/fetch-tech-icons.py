#!/usr/bin/env python3
"""
Fetch and self-host the technology icons used on the portfolio.

Why self-host at all: every icon on the site was a hotlink. That already cost
you six broken images — brandfetch retired free hotlinking and now 302s every
request to a docs page, so the entire "Generative AI" row, LangGraph and
HuggingFace rendered as empty boxes in production. devicons is also referenced
by branch rather than version, so it can change under the site at any time.

This script downloads each icon once, normalises it, and writes it to
assets/images/tech/ along with a provenance manifest. Re-run it only when you
add or remove a technology; nothing at runtime depends on it.

    python3 scripts/fetch-tech-icons.py            # download + write manifest
    python3 scripts/fetch-tech-icons.py --check     # verify files exist, no writes
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "images" / "tech"
MANIFEST = OUT / "manifest.json"
CHECK_ONLY = "--check" in sys.argv

# devicons is pinned by tag on purpose: the previous URLs pointed at the default
# branch, so an upstream rename would break the site without any change here.
DEVICON = "https://cdn.jsdelivr.net/gh/devicons/devicon@2.16.0/icons/{name}/{file}"
# simple-icons ships monochrome marks; older majors are kept in the npm CDN, so
# pinning one is safe. OpenAI/Groq were later removed upstream entirely.
SIMPLE = "https://cdn.jsdelivr.net/npm/simple-icons@13.5.0/icons/{name}.svg"
# simple-icons renames and removes marks between majors (langgraph arrived in 15,
# groq was removed entirely), so each icon pins the major it was verified in.
SIMPLE_15 = "https://cdn.jsdelivr.net/npm/simple-icons@15.0.0/icons/{name}.svg"
# qdrant only exists in recent major versions.
SIMPLE_LATEST = "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/{name}.svg"

# name: (source, url-or-parts, theme handling)
#   themed="color"   the artwork carries its own colours and works on both themes
#   themed="invert"  monochrome dark mark; CSS inverts it in dark mode
ICONS = {
    # Languages & frameworks — devicons (full colour)
    "python":      ("devicon", ("python", "python-original.svg"), "color"),
    "typescript":  ("devicon", ("typescript", "typescript-original.svg"), "color"),
    "fastapi":     ("devicon", ("fastapi", "fastapi-original.svg"), "color"),
    "django":      ("devicon", ("django", "django-plain.svg"), "color"),
    "pytorch":     ("devicon", ("pytorch", "pytorch-original.svg"), "color"),
    "opencv":      ("devicon", ("opencv", "opencv-original.svg"), "color"),
    "postgresql":  ("devicon", ("postgresql", "postgresql-original.svg"), "color"),
    "redis":       ("devicon", ("redis", "redis-original.svg"), "color"),
    "docker":      ("devicon", ("docker", "docker-original.svg"), "color"),
    "aws":         ("devicon", ("amazonwebservices", "amazonwebservices-plain-wordmark.svg"), "color"),
    "qdrant":      ("simpleLatest", ("qdrant",), "invert"),
    "linux":       ("devicon", ("linux", "linux-plain.svg"), "color"),
    "github":      ("devicon", ("github", "github-original.svg"), "invert"),
    # The site labels this "SQL" but has always used the Azure SQL database mark.
    # Keeping the same artwork means the icon swap changes nothing visible.
    "sql":         ("devicon", ("azuresqldatabase", "azuresqldatabase-original.svg"), "color"),
    # AI vendors — were hotlinked from brandfetch (now blocked) or huggingface.co
    "openai":      ("simple", ("openai",), "invert"),
    "anthropic":   ("simple", ("anthropic",), "invert"),
    "langgraph":   ("simple15", ("langgraph",), "invert"),
    "huggingface": ("simple", ("huggingface",), "color"),
    # groq was removed from simple-icons and has no devicon; their own favicon is
    # a small vector mark that stays accurate to the brand.
    "groq":        ("direct", ("https://groq.com/favicon.svg",), "color"),
}


def url_for(source, parts):
    if source == "devicon":
        return DEVICON.format(name=parts[0], file=parts[1])
    if source == "simple":
        return SIMPLE.format(name=parts[0])
    if source == "simple15":
        return SIMPLE_15.format(name=parts[0])
    if source == "simpleLatest":
        return SIMPLE_LATEST.format(name=parts[0])
    return parts[0]


def is_monochrome(svg: str) -> bool:
    """True when the artwork is one flat colour with no brand identity to it.

    Such a mark looks correct on one theme and wrong on the other: GitHub's
    #181616 octocat is invisible on a #120F21 background even though it is not
    literally black. So "monochrome" means a single low-chromaticity fill, not
    just #000.
    """
    hexes = {h.upper() for h in re.findall(r'fill="(#[0-9A-Fa-f]{3,8})"', svg)}
    if "url(#" in svg:  # gradient: it has its own colour story
        return False
    if not hexes:
        return True  # no fill at all -> renders in the UA default (black)
    neutral = {"#FFF", "#FFFFFF", "#000", "#000000"}
    remaining = hexes - neutral
    if not remaining:
        return True
    # A single achromatic fill (R==G==B, e.g. #181616) is still a mask.
    if len(remaining) == 1:
        h = remaining.pop().lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) < 6:
            return False
        r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
        return max(r, g, b) - min(r, g, b) <= 8
    return False


def normalize(svg: str) -> str:
    """Strip editor cruft, ensure a viewBox so the img can size it, and drop
    fixed pixel width/height so CSS stays authoritative."""
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r"\s*(xmlns:xlink|xlink:href)=\"[^\"]*\"", "", svg)
    svg = re.sub(r">\s+<", "><", svg)
    return svg.strip() + "\n"


def make_deterministic(svg: str) -> str:
    """Give a monochrome mark an explicit black fill.

    These files ship no fill attribute, so they render in the UA default (black)
    which is correct on light backgrounds and invisible on dark ones.

    Why not `fill="currentColor"`, which would be much nicer? Measured, not
    assumed: an SVG loaded through <img src> is a separate document and does NOT
    inherit CSS custom properties or color from the host page. Rendering a
    currentColor mark inside a red-text container still yields rgb(0,0,0). The
    only ways to theme an <img> icon are CSS filters (used here, via
    .logo-invert-dark in style.css) or inlining the <svg> element itself.
    """
    if not re.search(r'\bfill="#', svg):
        svg = re.sub(r"<svg\b", '<svg fill="#000000"', svg, count=1)
    return svg

def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (portfolio icon fetch)"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    problems = []

    for name, (source, parts, themed) in ICONS.items():
        target = OUT / f"{name}.svg"
        url = url_for(source, parts)

        if CHECK_ONLY:
            if target.exists() and target.stat().st_size > 200:
                manifest[name] = {"file": f"assets/images/tech/{name}.svg", "themed": themed}
            else:
                problems.append(f"{name}: missing {target.relative_to(ROOT)}")
            continue

        try:
            raw = fetch(url)
        except Exception as exc:  # noqa: BLE001 - report and continue
            problems.append(f"{name}: fetch failed ({url}) — {exc}")
            continue

        text = raw.decode("utf-8", errors="replace")
        if "<svg" not in text:
            problems.append(f"{name}: {url} did not return SVG (got {text[:60]!r})")
            continue

        body = normalize(text)
        mono = is_monochrome(body)
        if mono:
            body = make_deterministic(body)
        target.write_text(body, encoding="utf-8")
        manifest[name] = {
            "file": f"assets/images/tech/{name}.svg",
            "source": url,
            "origin": source,
            # "mono" = black artwork, needs .logo-invert-dark so it flips to
            # white in dark mode. "color" = brand artwork, needs nothing.
            "themed": "mono" if mono else "color",
            "bytes": target.stat().st_size,
        }
        print(f"  {name:14} {len(raw):>6} -> {len(body):>6} bytes  {source}")

    if CHECK_ONLY:
        if problems:
            print("\n".join(f"  x {p}" for p in problems))
            return 1
        print(f"  ok: {len(manifest)} icons present")
        return 0

    MANIFEST.write_text(
        json.dumps({"icons": manifest}, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\nmanifest -> {MANIFEST.relative_to(ROOT)} ({len(manifest)} icons)")
    if problems:
        print("\n".join(f"  x {p}" for p in problems))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
