#!/usr/bin/env python3
"""
Optimize site images -> WebP, and emit a dimensions manifest for the build.

Why a manifest: the static build (scripts/build.js) needs intrinsic width/height
for every <img> so browsers can reserve space and avoid layout shift (CLS).
Rather than probing image files from Node, we do it once here and write JSON.

Usage:
    python3 scripts/optimize-images.py            # convert + write manifest
    python3 scripts/optimize-images.py --check    # report only, write nothing

Output:
    *.webp files next to their originals (originals stay as <picture> fallbacks)
    assets/data/image-dims.json -> { "<src>": {w, h, webp, bytes, hasWebp, animated} }

The manifest is committed, not scratch state: assets/js/blog.js fetches it at
runtime so the client-side fallback renders images with the same intrinsic
dimensions as the pre-rendered pages. WebP is skipped when it is not actually
smaller, and animated GIFs are recorded but never converted.
"""

import json
import os
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
# Committed and served: assets/js/blog.js fetches this at runtime so the
# client-side fallback gets the same dimensions as the pre-rendered pages.
MANIFEST = ROOT / "assets" / "data" / "image-dims.json"

# Where to look for images, and the max width we ever need.
# Content images render at <= ~760px CSS wide; we ship 2x for retina.
TARGETS = [
    ("assets/images", 1000),
    ("blogs", 1600),
]

# Never downscale below this; small icons/logos stay pixel-exact.
SKIP_UNDER_PX = 512
QUALITY = 82
CHECK_ONLY = "--check" in sys.argv


def iter_images():
    for subdir, max_w in TARGETS:
        base = ROOT / subdir
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix.lower() == ".gif":
                yield path, max_w
            elif path.suffix.lower() in (".png", ".jpg", ".jpeg"):
                yield path, max_w


def optimize(path: Path, max_w: int):
    """Write a WebP companion for `path`. Returns stats dict."""
    rel = path.relative_to(ROOT).as_posix()
    with Image.open(path) as im:
        orig_w, orig_h = im.size
        fmt = (im.format or "").upper()

        # Animated GIFs: Pillow would flatten to one frame, and WebP conversion
        # kills the animation. Record real dimensions, keep the file as-is.
        if fmt == "GIF":
            return {
                "src": rel, "webp": rel, "original": rel,
                "w": orig_w, "h": orig_h,
                "origBytes": path.stat().st_size, "webpBytes": path.stat().st_size,
                "downscaled": False, "hasAlpha": True,
            }

        # Flatten alpha for photos where it is fully opaque; keeps WebP small.
        has_alpha = im.mode in ("RGBA", "LA", "P") and (
            "transparency" in im.info
            or (im.mode in ("RGBA", "LA") and im.getextrema()[-1][0] < 255)
        )

        target_w = min(orig_w, max_w)
        downscale = orig_w > target_w and orig_w > SKIP_UNDER_PX

        img = im
        if downscale:
            target_h = round(orig_h * target_w / orig_w)
            img = im.resize((target_w, target_h), Image.LANCZOS)
        else:
            target_w, target_h = orig_w, orig_h

        webp_path = path.with_suffix(".webp")
        orig_bytes = path.stat().st_size
        if CHECK_ONLY:
            saved = 0
        else:
            out = img
            if not has_alpha and out.mode != "RGB":
                out = out.convert("RGB")
            out.save(webp_path, "WEBP", quality=QUALITY, method=6)
            saved = webp_path.stat().st_size
            # WebP is not always a win (already-dense JPEGs, small PNGs). If it
            # is not meaningfully smaller, drop it and serve the original.
            if saved >= orig_bytes * 0.95:
                webp_path.unlink()
                webp_path = path
                saved = orig_bytes

    return {
        "src": rel,
        "webp": webp_path.relative_to(ROOT).as_posix() if not CHECK_ONLY else rel,
        "original": rel,
        "w": target_w,
        "h": target_h,
        "origBytes": path.stat().st_size,
        "webpBytes": saved,
        "downscaled": downscale,
        "hasAlpha": has_alpha,
    }


def main():
    stats = []
    for path, max_w in iter_images():
        # Skip already-generated webp siblings (they are outputs, not inputs).
        s = optimize(path, max_w)
        if s:
            stats.append(s)

    total_orig = sum(s["origBytes"] for s in stats)
    total_new = sum(s["webpBytes"] for s in stats)

    print(f"{'FILE':<58} {'WxH':>12} {'ORIG':>9} {'WEBP':>9}")
    print("-" * 92)
    for s in sorted(stats, key=lambda x: -x["origBytes"]):
        if s["origBytes"] < 20_000 and s["webpBytes"] == 0:
            continue
        new = f"{s['webpBytes']/1024:,.0f} KB" if s["webpBytes"] else "-"
        note = " (scaled down)" if s["downscaled"] else ""
        print(f"{s['src']:<58} {s['w']}x{s['h']:<7} {s['origBytes']/1024:,.0f} KB -> {new}{note}")

    if not CHECK_ONLY:
        MANIFEST.parent.mkdir(exist_ok=True)
        manifest = {
            s["src"]: {
                "w": s["w"],
                "h": s["h"],
                "webp": s["webp"],
                "bytes": s["webpBytes"] or s["origBytes"],
                # True when we actually produced a WebP companion; false when
                # the original was already the smaller file.
                "hasWebp": s["webp"] != s["src"],
                "animated": s["src"].endswith(".gif"),
            }
            for s in stats
        }
        # Also record the animated GIF (kept as-is).
        MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"\nmanifest -> {MANIFEST.relative_to(ROOT)} ({len(manifest)} images)")

    if total_new:
        print(
            f"\ntotal: {total_orig/1024/1024:.1f} MB -> {total_new/1024/1024:.1f} MB "
            f"({100 - total_new/total_orig*100:.0f}% smaller)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
