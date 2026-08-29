#!/usr/bin/env node
// scripts/test-render.js
//
// Regression tests for assets/js/post-render.js. Run with `npm test`.
//
// These exist because two bugs in the image/caption pipeline were shipped
// silently once:
//   1. Root-relative markdown image paths resolved against the wrong directory
//      for blogs/<slug>/index.html, 404ing every image on a real post page.
//   2. A lazy <picture>[\s\S]*?</picture> regex backtracked across paragraph
//      boundaries and wrapped 9,700 characters of article prose into a single
//      <figcaption>. The page still "looked fine-ish", which is why it needed
//      an assertion rather than a glance.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const P = require("../assets/js/post-render.js");
const MD = require("./markdown.js");

const ROOT = path.resolve(__dirname, "..");
const dims = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/data/image-dims.json"), "utf8"));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message.split("\n").join("\n       ")}`);
    process.exitCode = 1;
  }
}

console.log("post-render.js");

// scripts/markdown.js must not leak its renderer into the global marked
// singleton; marked.use() mutates module state, and if that happened these
// tests would be validating policy they did not intend to.
test("markdown.js does not mutate the global marked singleton", () => {
  MD.createMarked();
  assert.strictEqual(marked.parse("<script>x</script>").includes("<script>"), true,
    "global marked should still pass raw HTML through untouched");
});

// ---- path resolution ------------------------------------------------------

test("markdown root-relative path becomes ./ relative inside a post dir", () => {
  const html = marked.parse("![cover](blogs/my-post/cover.png)");
  const out = P.renderPostHTML(html, {
    pagePath: "blogs/my-post/index.html",
    dims: { "blogs/my-post/cover.png": { w: 100, h: 50, webp: "blogs/my-post/cover.png", hasWebp: false } },
  });
  assert.match(out, /src="cover\.png"/, out);
  assert.doesNotMatch(out, /src="blogs\//, "must not keep the root-relative path");
});

test("root-relative path stays root-relative from a top-level page", () => {
  const html = marked.parse("![cover](blogs/my-post/cover.png)");
  const out = P.renderPostHTML(html, { pagePath: "post.html" });
  assert.match(out, /src="blogs\/my-post\/cover\.png"/, out);
});

test("cross-post and up-one-directory references resolve", () => {
  assert.strictEqual(P.relativeFrom("blogs/a/index.html", "blogs/b/x.png"), "../b/x.png");
  assert.strictEqual(P.relativeFrom("blogs/a/index.html", "assets/images/x.png"), "../../assets/images/x.png");
  assert.strictEqual(P.relativeFrom("index.html", "assets/x.png"), "assets/x.png");
});

test("absolute URLs are left alone", () => {
  const html = marked.parse("![x](https://example.com/a.png)");
  const out = P.renderPostHTML(html, { pagePath: "blogs/a/index.html" });
  assert.match(out, /src="https:\/\/example\.com\/a\.png"/, out);
});

// ---- dimensions + lazy loading -------------------------------------------

test("known images get width/height and a WebP source", () => {
  // Paths are authored site-root-relative, per the contract in post-render.js.
  const html = marked.parse("![one](blogs/p/a.png)\n\n![two](blogs/p/b.png)");
  const out = P.renderPostHTML(html, {
    pagePath: "blogs/p/index.html",
    dims: {
      "blogs/p/a.png": { w: 800, h: 600, webp: "blogs/p/a.webp", hasWebp: true },
      "blogs/p/b.png": { w: 400, h: 300, webp: "blogs/p/b.png", hasWebp: false },
    },
  });
  assert.match(out, /width="800" height="600"/, out);
  assert.match(out, /<picture><source type="image\/webp" srcset="a\.webp">/, "webp source expected");
  assert.match(out, /<img src="b\.png"[^>]*>/, "non-webp image still renders");
  assert.equal((out.match(/<picture>/g) || []).length, 1, "only the webp-backed image gets a <picture>");
});

test("first image is the eager cover, the rest are lazy", () => {
  const html = marked.parse("![one](a.png)\n\n![two](b.png)\n\n![three](c.png)");
  const out = P.renderPostHTML(html, { pagePath: "blogs/p/index.html" });
  assert.equal((out.match(/loading="eager"/g) || []).length, 1, "exactly one eager image");
  assert.equal((out.match(/loading="lazy"/g) || []).length, 2, "everything else lazy");
  assert.equal((out.match(/fetchpriority="high"/g) || []).length, 1);
  assert.ok(out.indexOf("eager") < out.indexOf("lazy"), "cover must come first");
});

// ---- captions -------------------------------------------------------------

test("caption folds into <figure> when image and <em> are one paragraph", () => {
  const html = marked.parse("![alt](i.png)\n*the caption*");
  const out = P.renderPostHTML(html, { pagePath: "blogs/p/index.html" });
  assert.match(out, /<figure class="post-figure">.*<figcaption>the caption<\/figcaption><\/figure>/s, out);
});

test("caption folds when separated by a blank line", () => {
  const html = marked.parse("![alt](i.png)\n\n*the caption*");
  const out = P.renderPostHTML(html, { pagePath: "blogs/p/index.html" });
  assert.match(out, /<figcaption>the caption<\/figcaption>/, out);
});

test("caption folding never spans paragraphs (9.7k-char figure regression)", () => {
  const md = [
    "![cover](blogs/p/cover.png)",
    "",
    "*cover note*",
    "",
    "## Section",
    "",
    "A real paragraph of body text that must not end up inside a figcaption.",
    "",
    "![second](blogs/p/second.png)",
    "*second note*",
  ].join("\n");
  const out = P.renderPostHTML(marked.parse(md), { pagePath: "blogs/p/index.html" });
  const figures = [...out.matchAll(/<figure[\s\S]*?<\/figure>/g)].map((m) => m[0]);
  assert.equal(figures.length, 2, "two figures expected");
  for (const f of figures) {
    assert.ok(f.length < 500, `figure too long (${f.length} chars) — regex crossed a boundary`);
    assert.ok(!/Section|body text/.test(f), "prose leaked into a figure");
  }
  assert.ok(/<p>A real paragraph/.test(out), "prose paragraph should survive outside figures");
});

test("uncaptioned image is unwrapped from its paragraph", () => {
  const html = marked.parse("![alt](i.png)\n\n\nbody text");
  const out = P.renderPostHTML(html, { pagePath: "blogs/p/index.html" });
  assert.doesNotMatch(out, /<p><img/, "bare image should not sit in a <p>");
  assert.match(out, /<p>body text<\/p>/, out);
});

test("a caption that contains a link survives", () => {
  const html = marked.parse("![alt](i.png)\n*see [the study](https://x.test/a)*");
  const out = P.renderPostHTML(html, { pagePath: "blogs/p/index.html" });
  assert.match(out, /<figcaption>see <a href="https:\/\/x\.test\/a"/, out);
});

// ---- headings, links, XSS ------------------------------------------------

test("headings get unique ids, with collision suffixes", () => {
  const html = marked.parse("## Setup\n\n### Setup\n\n## Setup");
  const out = P.renderPostHTML(html, { pagePath: "blogs/p/index.html" });
  const ids = [...out.matchAll(/<h[23] id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["setup", "setup-2", "setup-3"], JSON.stringify(ids));
});

test("heading text stays readable when the anchor is stripped", () => {
  const out = P.renderPostHTML(marked.parse("## The harness"), { pagePath: "blogs/p/index.html" });
  const text = /<h2[^>]*>([\s\S]*?)<a class="heading-anchor"/.exec(out);
  assert.ok(text, "anchor should come after the text");
  assert.strictEqual(text[1].trim(), "The harness");
});

test("external links are marked, internal ones are not", () => {
  const html = marked.parse("[off](https://example.com) and [on](other.html)");
  const out = P.renderPostHTML(html, { pagePath: "blogs/p/index.html" });
  assert.match(out, /href="https:\/\/example\.com"[^>]*rel="noopener noreferrer nofollow"/, out);
  assert.doesNotMatch(out, /other\.html"[^>]*target=/, "internal links stay in place");
});

test("raw HTML in markdown cannot reach the DOM", () => {
  const out = MD.toHTML("<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>");
  assert.doesNotMatch(out, /<script/i, "no raw script tag may reach the DOM");
  assert.doesNotMatch(out, /<img src=x/i, "raw img must not pass through unescaped");
  assert.match(out, /&lt;script&gt;/, "should be escaped into visible text");
});

test("allow-listed raw HTML survives, without attributes", () => {
  assert.match(MD.toHTML("press <kbd>Ctrl</kbd>"), /<kbd>Ctrl<\/kbd>/);
  assert.doesNotMatch(MD.toHTML('<kbd onclick="x()">C</kbd>'), /onclick/);
});

test("hostile link schemes are neutralised, safe ones are not", () => {
  assert.strictEqual(P.isSafeHref("https://ok.test"), true);
  assert.strictEqual(P.isSafeHref("#section"), true);
  assert.strictEqual(P.isSafeHref("other-post/"), true);
  assert.strictEqual(P.isSafeHref("javascript:alert(1)"), false);
  assert.strictEqual(P.isSafeHref("JaVaScRiPt:alert(1)"), false);
  assert.strictEqual(P.isSafeHref("java\tscript:alert(1)"), false, "tab-split scheme must not sneak through");
  assert.strictEqual(P.isSafeHref("data:text/html,<script>"), false);

  const out = P.renderPostHTML(marked.parse("[x](javascript:alert(1))"), { pagePath: "blogs/p/index.html" });
  assert.doesNotMatch(out, /javascript:/i, "hostile href must be gone");
  assert.match(out, /<a[^>]*href="#inert-link"/, "link is neutralised, not deleted");
  assert.match(out, /<\/a>/, "closing tag preserved so the DOM stays balanced");
});

test("code blocks are highlighted with a language label", () => {
  const out = MD.toHTML("```python\nx = 1 + 2\n```");
  assert.match(out, /class="language-python hljs"/, out);
  assert.match(out, /class="code-lang"/, "language chip expected");
  assert.match(out, /<span class="hljs-number">1<\/span>/, "token markup expected");
});

// ---- metadata helpers -----------------------------------------------------

test("reading time is sane for a long post", () => {
  const src = fs.readFileSync(path.join(ROOT, "blogs/holy-trinity-pi-herdr-opencode/blog.md"), "utf8");
  const rt = P.readingTime(src);
  assert.ok(rt.words > 1500, `expected a long post, got ${rt.words} words`);
  assert.ok(rt.minutes >= 5 && rt.minutes <= 20, `implausible reading time: ${rt.minutes}`);
});

test("excerpt strips markup and truncates on a word boundary", () => {
  const got = P.excerpt("> tldr; my **current** [AI setup](https://x.test) is quite long ".repeat(4), 80);
  assert.ok(got.length <= 80, `too long: ${got.length}`);
  assert.doesNotMatch(got, /[*[\]]/, "markdown syntax should be gone");
});

// ---- real content end to end ---------------------------------------------

test("every published post renders without prose-eating figures", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "posts.json"), "utf8"));
  for (const entry of manifest) {
    const raw = fs.readFileSync(path.join(ROOT, entry.path), "utf8");
    const out = P.renderPostHTML(marked.parse(raw), { pagePath: `blogs/${entry.slug}/index.html`, dims });
    for (const f of [...out.matchAll(/<figure[\s\S]*?<\/figure>/g)]) {
      assert.ok(f[0].length < 600, `${entry.slug}: figure is ${f[0].length} chars — prose swallowed`);
    }
    // Image count must be preserved: nothing dropped, nothing duplicated.
    const authored = (raw.match(/^!?\s*!\[/gm) || []).length + (raw.match(/^\s+!\[/gm) || []).length;
    const rendered = (out.match(/<img\b/g) || []).length;
    assert.ok(rendered >= 3, `${entry.slug}: only ${rendered} images rendered`);
    assert.strictEqual(
      rendered,
      (raw.match(/!\[[^\]]*\]\([^)\s]+/g) || []).length,
      `${entry.slug}: rendered ${rendered} images but markdown has ${
        (raw.match(/!\[[^\]]*\]\([^)\s]+/g) || []).length
      }`
    );
    assert.ok(authored > 0, `${entry.slug}: no images found to test`);
  }
});

console.log(`\n${passed} test(s) passed${process.exitCode ? " (with failures)" : ""}`);
