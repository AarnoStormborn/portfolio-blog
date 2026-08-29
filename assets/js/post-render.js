// assets/js/post-render.js
//
// Single source of truth for turning a blog post's markdown-derived HTML into
// the markup we actually ship. Used by:
//   - scripts/build.js   (pre-renders blogs/<slug>/index.html at build time,
//                         via require() — see the module.exports guard below)
//   - assets/js/blog.js  (client-side fallback at post.html?post=<slug>)
//
// Both paths must produce identical HTML, or the JS-rendered page and the
// static page would look different. One file, one implementation.
//
// Responsibilities:
//   1. Resolve image src relative to the page doing the rendering.
//   2. Emit <picture> with a WebP source where one exists.
//   3. Set width/height from assets/data/image-dims.json to prevent layout shift.
//   4. Fold an image + the following *caption* paragraph into <figure>.
//   5. Mark external links, neutralise hostile URL schemes, add heading anchors.
//
// Path contract: image paths in blog markdown are authored site-root-relative
// ("blogs/my-post/cover.png"), NOT relative to the .md file. rewriteImages
// converts them to be relative to whichever page renders the post, so the same
// markdown works at blogs/<slug>/index.html and at post.html?post=<slug>.
//
// This is a *classic* script (not ESM) so it can be loaded with a plain
// <script> tag and with require(). Keep it that way.

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PostRender = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ---- posix path helpers (no node:path, must work in the browser) --------

  function splitPath(p) {
    return p.split("/").filter(function (s) {
      return s !== "" && s !== ".";
    });
  }

  function isAbsoluteUrl(p) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.indexOf("//") === 0;
  }

  /** Collapse any authored path to a root-relative one, or null if remote. */
  function normalizeRooted(p) {
    if (isAbsoluteUrl(p)) return null;
    var src = p.charAt(0) === "/" ? p.slice(1) : p;
    var out = [];
    var segs = src.split("/");
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (seg === "" || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    return out.join("/");
  }

  /** `target` (root-relative) expressed relative to `pagePath` (root-relative). */
  function relativeFrom(pagePath, target) {
    var fromDir = splitPath(pagePath).slice(0, -1);
    var to = splitPath(target);
    var common = 0;
    // Never consume the target's filename as a "common" directory segment.
    while (
      common < fromDir.length &&
      common < to.length - 1 &&
      fromDir[common] === to[common]
    ) {
      common++;
    }
    var parts = [];
    for (var i = common; i < fromDir.length; i++) parts.push("..");
    for (var j = common; j < to.length; j++) parts.push(to[j]);
    return parts.length ? parts.join("/") : ".";
  }

  // ---- small utils --------------------------------------------------------

  function getAttr(attrs, name) {
    var m = new RegExp("\\b" + name + "\\s*=\\s*\"([^\"]*)\"").exec(attrs) ||
      new RegExp("\\b" + name + "\\s*=\\s*'([^']*)'").exec(attrs);
    return m ? m[1] : null;
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function slugify(s) {
    return String(s)
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60);
  }

  /** Manifest keys are root-relative srcs; match ignoring extension changes. */
  function lookupDims(dims, rooted) {
    if (dims[rooted]) return dims[rooted];
    var base = rooted.replace(/\.[^.]+$/, "");
    for (var key in dims) {
      if (!Object.prototype.hasOwnProperty.call(dims, key)) continue;
      if (key === rooted || key.indexOf(base + ".") === 0) return dims[key];
    }
    return null;
  }

  function attr(parts) {
    return parts
      .filter(function (p) {
        return !!p;
      })
      .join(" ");
  }

  // ---- transforms ---------------------------------------------------------

  /**
   * marked emits bare <img> tags with the src exactly as authored in markdown.
   * Those are wrong twice over: they are not relative to the rendering page,
   * and they carry no dimensions. Rewrite them into <picture>/<img>.
   *
   * The first image in a document is the cover. It is the LCP element, so it
   * gets eager loading + high fetch priority; everything after is lazy.
   */
  function rewriteImages(html, pagePath, dims) {
    var seen = 0;
    return html.replace(/<img\b([^>]*)\/?>/g, function (match, attrs) {
      var src = getAttr(attrs, "src");
      var alt = getAttr(attrs, "alt");
      if (alt === null) alt = "";

      if (!src) return match;

      // Remote image: nothing to relativise or dimension, just hint it.
      if (isAbsoluteUrl(src)) {
        if (/\bloading=/.test(attrs)) return match;
        return match.replace(
          /(\s*\/?)>$/,
          ' loading="lazy" decoding="async"$1>'
        );
      }

      var rooted = normalizeRooted(src);
      if (!rooted) return match;

      var entry = lookupDims(dims, rooted);
      var isCover = seen === 0;
      seen++;

      var imgAttrs = attr([
        'src="' + escapeAttr(relativeFrom(pagePath, rooted)) + '"',
        'alt="' + escapeAttr(alt) + '"',
        entry ? 'width="' + entry.w + '"' : "",
        entry ? 'height="' + entry.h + '"' : "",
        isCover ? 'loading="eager"' : 'loading="lazy"',
        isCover ? 'fetchpriority="high"' : "",
        'decoding="async"',
        isCover ? 'class="post-cover"' : "",
      ]);

      var hasWebp = entry && entry.hasWebp && !entry.animated;
      if (hasWebp) {
        var webpRel = escapeAttr(relativeFrom(pagePath, entry.webp));
        return (
          '<picture><source type="image/webp" srcset="' +
          webpRel +
          '"><img ' +
          imgAttrs +
          "></picture>"
        );
      }
      return "<img " + imgAttrs + ">";
    });
  }

  // Exactly the shape rewriteImages emits, so caption matching can never span
  // a paragraph boundary. A permissive <picture>[\s\S]*?</picture> backtracks
  // across </p> boundaries and silently merges unrelated blocks.
  // Requires escapeAttr to also escape ">" so attribute values cannot contain it.
  var PIC = "<picture><source[^>]*><img[^>]*></picture>";
  var IMGX = "<img[^>]*>";

  /**
   * This blog's caption convention is:
   *
   *     ![alt](image.png)
   *     *caption text*
   *
   * marked renders that in two different shapes depending on whether the
   * author left a blank line between the two, so handle both:
   *   A. one paragraph    <p><img>\n<em>cap</em></p>
   *   B. two paragraphs   <p><img></p><p><em>cap</em></p>
   * Fold each pair into a real <figure>/<figcaption> so the caption is
   * semantically attached to its image.
   */
  function foldCaptions(html) {
    var one = new RegExp(
      "<p>\\s*(" + PIC + "|" + IMGX + ")\\s*<em>([\\s\\S]*?)</em>\\s*</p>",
      "g"
    );
    var two = new RegExp(
      "<p>\\s*(" + PIC + "|" + IMGX + ")\\s*</p>\\s*<p>\\s*<em>([\\s\\S]*?)</em>\\s*</p>",
      "g"
    );
    var figure = function (_m, img, caption) {
      return (
        '<figure class="post-figure">' +
        img +
        "<figcaption>" +
        caption.trim() +
        "</figcaption></figure>"
      );
    };
    // Order matters: shape A can also match the tail of shape B's image
    // paragraph, so consume the two-paragraph form first.
    return html.replace(two, figure).replace(one, figure);
  }

  /**
   * An image with no caption still arrives wrapped in a <p>. That paragraph is
   * redundant and inherits paragraph margins, so unwrap it. Runs after
   * foldCaptions, which handles the captioned case.
   */
  function unwrapFigureParagraphs(html) {
    var re = new RegExp("<p>\\s*(" + PIC + "|" + IMGX + ")\\s*</p>", "g");
    return html.replace(re, function (_m, img) {
      return img;
    });
  }

  /** Off-site links open in a new tab, without leaking referrer or SEO weight. */
  function markExternalLinks(html) {
    return html.replace(
      /<a\b([^>]*?)href="([^"]*)"([^>]*)>/g,
      function (m, pre, href, post) {
        if (!isSafeHref(href)) {
          // Neutralise in place rather than deleting the tag: swapping <a> for
          // <span> would leave the </a> unmatched and corrupt the DOM. Pointing
          // at an anchor keeps the text selectable and the click harmless.
          return '<a' + pre + 'href="#inert-link"' + post + ' rel="nofollow">';
        }
        if (!EXTERNAL.test(href)) return m; // internal or relative: leave alone
        var existing = pre + post;
        if (/\btarget=/.test(existing)) return m;
        var rel = getAttr(existing, "rel");
        var relAttr = rel ? 'rel="' + rel + ' noopener noreferrer nofollow"' : 'rel="noopener noreferrer nofollow"';
        return "<a" + pre + 'href="' + href + '"' + post + ' target="_blank" ' + relAttr + ">";
      }
    );
  }

  var EXTERNAL = /^(https?:)?\/\//i;

  /**
   * Allowed URL schemes for links. Anything else (javascript:, data:, vbscript:
   * and friends) is treated as hostile even though the blog is hand-authored:
   * markdown gets pasted from elsewhere more often than you would think.
   */
  var SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:|#|\/|\.{1,2}\/|[\w.-]+\/|[\w.-]+\.[a-z]{2,}(\/|$))/i;

  function isSafeHref(href) {
    var h = String(href || "").replace(/[\u0000-\u001f\s]+/g, "").toLowerCase();
    if (!h) return false;
    if (/^(javascript|data|vbscript|file|blob):/.test(h)) return false;
    return SAFE_HREF.test(h) || /^[\w.-]+$/.test(h);
  }

  /** Stable ids on h2/h3 so sections are deep-linkable from social/Twitter. */
  function addHeadingAnchors(html, usedIds) {
    usedIds = usedIds || {};
    return html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, function (m, level, text) {
      var base = slugify(text.replace(/<[^>]+>/g, ""));
      if (!base) return m;
      var id = base;
      var n = 2;
      while (usedIds[id]) {
        id = base + "-" + n++;
      }
      usedIds[id] = true;
      return (
        '<h' +
        level +
        ' id="' +
        id +
        '" class="post-heading">' +
        text +
        '<a class="heading-anchor" href="#' +
        id +
        '" aria-label="Permalink to this section">#</a>' +
        "</h" +
        level +
        ">"
      );
    });
  }

  // ---- entry point --------------------------------------------------------

  /**
   * @param {string} html      marked.parse() output for the post body
   * @param {object} opts
   * @param {string} opts.pagePath  root-relative page rendering this post,
   *                                e.g. "blogs/my-post/index.html"
   * @param {object} [opts.dims]    assets/data/image-dims.json, keyed by src
   * @returns {string} the HTML to inject
   */
  function renderPostHTML(html, opts) {
    opts = opts || {};
    var pagePath = opts.pagePath || "post.html";
    var dims = opts.dims || {};
    var out = html;
    out = rewriteImages(out, pagePath, dims);
    out = foldCaptions(out);
    out = unwrapFigureParagraphs(out);
    out = markExternalLinks(out);
    out = addHeadingAnchors(out, {});
    return out.trim();
  }

  /** Rough reading time. 220wpm suits prose that contains code blocks. */
  function readingTime(markdown) {
    var words = String(markdown)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#*_>`|]/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;
    return { words: words, minutes: Math.max(1, Math.round(words / 220)) };
  }

  /** First non-empty, non-image line of a post body, as a plain-text deck. */
  function excerpt(markdown, maxChars) {
    maxChars = maxChars || 160;
    var lines = String(markdown)
      .split(/\n+/)
      .map(function (l) {
        return l.trim();
      })
      .filter(function (l) {
        return l && !/^!\[/.test(l) && !/^#+\s/.test(l) && l !== "---";
      });
    var text = (lines[0] || "")
      .replace(/^>\s*/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "");
    return text.length > maxChars ? text.slice(0, maxChars - 1).trim() + "\u2026" : text;
  }

  return {
    renderPostHTML: renderPostHTML,
    rewriteImages: rewriteImages,
    foldCaptions: foldCaptions,
    unwrapFigureParagraphs: unwrapFigureParagraphs,
    isSafeHref: isSafeHref,
    markExternalLinks: markExternalLinks,
    addHeadingAnchors: addHeadingAnchors,
    readingTime: readingTime,
    excerpt: excerpt,
    slugify: slugify,
    normalizeRooted: normalizeRooted,
    relativeFrom: relativeFrom,
  };
});
