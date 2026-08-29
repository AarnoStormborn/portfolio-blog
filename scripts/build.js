#!/usr/bin/env node
// scripts/build.js
//
// Pre-renders every blog post to a real static HTML file, and generates the
// SEO surface around it (RSS, sitemap, robots, 404).
//
// Why pre-render at all: the site used to render posts client-side from
// post.html?post=<slug> with marked.js. That works for humans but crawlers and
// social scrapers saw an empty shell — no per-post URL, no og:image, no text.
// Static pages fix that; the client-side renderer stays as a fallback so an
// un-published .md can still be previewed.
//
//   node scripts/build.js            build
//   node scripts/build.js --check    build in memory, fail if committed files differ
//
// Inputs:  posts.json, blogs/<slug>/blog.md (optional YAML front matter)
// Outputs: blogs/<slug>/index.html, feed.xml, sitemap.xml, robots.txt,
//          404.html, assets/data/image-dims.json

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const cfg = require("./site.config");
const T = require("./templates");
const P = require("../assets/js/post-render.js");
const MD = require("./markdown.js");

const ROOT = cfg.ROOT;
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const VERBOSE = args.includes("--verbose");

const errors = [];
const warnings = [];

// Raw HTML tolerated inside blog markdown. Names only; attributes are stripped.
const RAW_HTML_ALLOW = new Set(["br", "kbd", "sub", "sup", "details", "summary", "mark"]);

function fail(file, msg) {
  errors.push(`${file}: ${msg}`);
}
function warn(file, msg) {
  warnings.push(`${file}: ${msg}`);
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// ---- markdown pipeline ----------------------------------------------------

const marked = MD.createMarked();
const escapeHtml = MD.escapeHtml;

// ---- manifest + posts -----------------------------------------------------

function loadManifest() {
  const file = cfg.blog.manifest;
  if (!exists(file)) {
    errors.push(`${file}: missing — the build needs it to know what to publish`);
    return [];
  }
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (e) {
    errors.push(`${file}: invalid JSON — ${e.message}`);
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push(`${file}: expected a JSON array`);
    return [];
  }
  return raw;
}

function parsePost(entry) {
  const src = entry.path;
  const slug = entry.slug;

  if (!exists(src)) {
    fail(cfg.blog.manifest, `"${slug}" points at ${src}, which does not exist`);
    return null;
  }

  const raw = readText(src);
  const { data, content } = matter(raw);

  if (data.slug && data.slug !== slug) {
    warn(src, `front matter slug "${data.slug}" differs from manifest slug "${slug}"`);
  }

  // Precedence: front matter, then the manifest, then the file's own history.
  // The .md is the content source of truth, and writeManifest() copies resolved
  // values back into posts.json — so if the manifest won, the first build would
  // freeze a derived date in place and every later edit to the post's front
  // matter would be silently ignored.
  const authoredDate = saneDate(data.date) || saneDate(entry.date);
  const date = authoredDate || earliestGitDate(src) || fileMtime(src);
  if (!saneDate(data.date) && !saneDate(entry.date)) {
    warn(
      src,
      `no date in front matter or ${cfg.blog.manifest} — derived "${date}" from the file's own history; set one explicitly`
    );
  }
  const dateObj = date ? new Date(String(date).slice(0, 10) + "T00:00:00Z") : null;
  if (dateObj && Number.isNaN(dateObj.getTime())) {
    fail(src, `unparseable date "${date}" — use YYYY-MM-DD`);
  }

  // The first image in the file is the cover, matching how the body renders it.
  const coverMatch = /!\[[^\]]*\]\(([^)\s]+)/.exec(content);
  let cover = coverMatch ? P.normalizeRooted(coverMatch[1]) : null;
  if (cover && !exists(cover)) {
    warn(src, `cover image not found: ${cover}`);
    cover = null;
  }

  const title = data.title || entry.title || deriveTitle(content) || slug;
  const description =
    data.description ||
    entry.description ||
    data.summary ||
    entry.summary ||
    P.excerpt(content, 155) ||
    cfg.site.description;

  const rt = P.readingTime(content);

  return {
    slug,
    title,
    description,
    date,
    dateObj,
    updated: data.updated || data.lastmod || null,
    tags: normalizeTags(entry.tags || data.tags),
    cover,
    src,
    content,
    words: rt.words,
    minutes: rt.minutes,
    draft: Boolean(data.draft),
    summary: entry.summary || P.excerpt(content, 180),
  };
}

function deriveTitle(content) {
  const m = /^#\s+(.+)$/m.exec(content);
  return m ? m[1].trim() : null;
}

function normalizeTags(tags) {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(",");
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
}

/**
 * A post needs a publication date for RSS, Atom and sitemap <lastmod>. Reading
 * it from git (then the filesystem) means a minimal {slug, path} manifest entry
 * still builds, instead of throwing deep inside the Atom writer.
 */
function earliestGitDate(relPath) {
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync(
      "git",
      ["log", "--diff-filter=A", "--format=%ad", "--date=short", "--", relPath],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    const first = out.split("\n").filter(Boolean).pop();
    return first && /^\d{4}-\d{2}-\d{2}$/.test(first) ? first : null;
  } catch (e) {
    return null; // not a git checkout, or git unavailable
  }
}

/**
 * Normalize an authored date to YYYY-MM-DD, or null.
 *
 * YAML is the trap here: gray-matter parses `date: 2026-05-04` into a JS Date,
 * whose String() is "Mon May 04 2026 ...". Testing only the string form made
 * every front-matter date silently fall through to "today", which is how a post
 * ends up published with the wrong date and nobody notices.
 */
function saneDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const d = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s || s === "undefined" || s === "null") return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(s);
  if (iso) return iso[0];
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function fileMtime(relPath) {
  try {
    return fs
      .statSync(path.join(ROOT, relPath))
      .mtime.toISOString()
      .slice(0, 10);
  } catch (e) {
    return null;
  }
}

// ---- reference validation -------------------------------------------------

/**
 * Catch broken image links at build time. These used to 404 silently in
 * production because markdown paths were authored root-relative while pages
 * live in subdirectories.
 */
function validateReferences(post, dims) {
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  let count = 0;
  while ((m = re.exec(post.content))) {
    count++;
    const [, alt, target] = m;
    if (/^(https?:)?\/\//i.test(target)) continue;
    const rooted = P.normalizeRooted(target);
    if (!rooted) continue;
    if (!exists(rooted)) {
      fail(post.src, `image reference "${target}" resolves to ${rooted}, which does not exist`);
      continue;
    }
    if (!dims[rooted]) {
      warn(post.src, `image "${rooted}" has no entry in the dimensions manifest — run \`npm run images\``);
    }
    if (!alt.trim() && !/decorative/.test(post.content)) {
      warn(post.src, `image "${rooted}" has empty alt text`);
    }
  }
  if (count === 0 && !post.cover) {
    warn(post.src, "post has no cover image — social previews will fall back to the site logo");
  }
}

// ---- TOC ------------------------------------------------------------------

function extractToc(html) {
  const out = [];
  const re =
    /<h([23]) id="([^"]+)" class="post-heading">([\s\S]*?)<a class="heading-anchor"[^>]*>#<\/a><\/h[23]>/g;
  let m;
  while ((m = re.exec(html))) {
    out.push({ depth: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, "").trim() });
  }
  return out;
}

// ---- feeds ----------------------------------------------------------------

function buildRss(posts) {
  const base = cfg.site.url.replace(/\/$/, "");
  // Deterministic: derived from the newest post, not Date.now(). A build
  // timestamp here made `--check` fail permanently, because feed.xml differed on
  // every run even with no content change — and it churned a git diff on each
  // publish for no reader benefit. RSS 2.0 treats lastBuildDate as optional.
  const newest = posts.reduce(
    (max, p) => (p.dateObj && (!max || p.dateObj > max) ? p.dateObj : max),
    null
  );
  const items = posts
    .slice(0, cfg.blog.rssItemCount)
    .map((p) => {
      const url = `${base}/${cfg.blog.outDir}/${p.slug}/`;
      return `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(url)}</link>
      <guid isPermaLink="true">${xml(url)}</guid>
      <pubDate>${rfc822(p.dateObj)}</pubDate>
      <description>${xml(p.summary)}</description>
${(p.tags || []).map((t) => `      <category>${xml(t)}</category>`).join("\n")}${
        p.cover ? `\n      <media:content url="${xml(absoluteFor(p.cover))}" medium="image" />` : ""
      }
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${xml(cfg.blog.feed.title)}</title>
    <link>${xml(base + "/blog.html")}</link>
    <guid isPermaLink="true">${xml(base + "/blog.html")}</guid>
    <atom:link href="${xml(base + "/" + cfg.blog.feed.file)}" rel="self" type="application/rss+xml" />
    <description>${xml(cfg.blog.feed.description)}</description>
    <language>en</language>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <generator>scripts/build.js</generator>
${newest ? `    <lastBuildDate>${rfc822(newest)}</lastBuildDate>\n` : ""}
${items}
  </channel>
</rss>
`;
}

function buildAtom(posts) {
  const base = cfg.site.url.replace(/\/$/, "");
  const latest = posts[0] ? posts[0].dateObj : new Date();
  const entries = posts
    .slice(0, cfg.blog.rssItemCount)
    .map((p) => {
      const url = `${base}/${cfg.blog.outDir}/${p.slug}/`;
      return `  <entry>
    <title>${xml(p.title)}</title>
    <link href="${xml(url)}" rel="alternate" type="text/html" />
    <id>${xml(url)}</id>
    <updated>${iso(p.updated || p.date)}</updated>
    <author><name>${xml(cfg.site.author)}</name></author>
    <summary>${xml(p.summary)}</summary>
    <content type="html">${xml(p.summary)}</content>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xml(cfg.blog.feed.title)}</title>
  <subtitle>${xml(cfg.blog.feed.description)}</subtitle>
  <link href="${xml(base + "/feed.xml")}" rel="self" type="application/atom+xml" />
  <link href="${xml(base + "/blog.html")}" rel="alternate" type="text/html" />
  <id>${xml(base + "/")}</id>
  <updated>${iso(latest)}</updated>
  <author><name>${xml(cfg.site.author)}</name><email>${xml(cfg.site.email)}</email></author>
  <generator>scripts/build.js</generator>
${entries}
</feed>
`;
}

function buildSitemap(posts) {
  const base = cfg.site.url.replace(/\/$/, "");
  const urls = [
    { loc: `${base}/`, priority: "1.0", changefreq: "monthly" },
    { loc: `${base}/blog.html`, priority: "0.9", changefreq: "weekly" },
    ...posts.map((p) => ({
      loc: `${base}/${cfg.blog.outDir}/${p.slug}/`,
      priority: "0.8",
      changefreq: "monthly",
      lastmod: iso(p.updated || p.date),
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${xml(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>\n    ` : ""}<changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;
}

function buildRobots() {
  const base = cfg.site.url.replace(/\/$/, "");
  return `User-agent: *
Allow: /

# Generated by scripts/build.js
Sitemap: ${base}/sitemap.xml
`;
}

function xml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[c]);
}
function iso(d) {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
  const parsed = new Date(String(d).slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}
function rfc822(d) {
  const parsed = d instanceof Date ? d : new Date(String(d).slice(0, 10) + "T00:00:00Z");
  return (Number.isNaN(parsed.getTime()) ? new Date(0) : parsed).toUTCString().replace("GMT", "+0000");
}
function absoluteFor(relPath) {
  return cfg.site.url.replace(/\/$/, "") + "/" + relPath.replace(/^\//, "");
}

/**
 * Rewrite posts.json, enriched with what the build knows.
 *
 * Authored fields (slug, path, and any explicit title/date/summary/tags) are
 * preserved; anything missing is filled from front matter or derived. So adding
 * a post is: create blogs/<slug>/blog.md, add {"slug","path"} to posts.json,
 * run the build. Ordering is always newest-first, and staticUrl means
 * assets/js/blog.js can link straight at the pre-rendered page instead of the
 * ?post= fallback.
 */
function writeManifest(posts) {
  const authored = {};
  for (const entry of loadManifest()) {
    if (entry.slug) authored[entry.slug] = entry;
  }
  const out = posts.map((p) => {
    const base = authored[p.slug] || {};
    const entry = {
      slug: p.slug,
      title: p.title,
      date: String(p.date).slice(0, 10),
      summary: p.summary,
      path: p.src,
      // Relative rather than "/blogs/<slug>/". Both consumers (blog.html and
      // post.html) sit at the root today, so the two are equivalent while the
      // site is served from a domain root — but a root-prefixed value breaks
      // the moment the site lives under a path, which is the same class of bug
      // that broke the markdown image paths originally. assets/js/blog.js
      // resolves this against the current page.
      staticUrl: `${cfg.blog.outDir}/${p.slug}/`,
      readingTime: p.minutes,
    };
    // A post whose date never resolved must not have a bogus one written back:
    // "undefined"/"Invalid Date" in posts.json then poisons every later build
    // and the feeds, which is worse than the missing date that caused it.
    if (!p.dateObj) {
      delete entry.date;
      errors.push(`${p.src}: cannot publish without a valid date (got "${p.date}")`);
    }
    if (p.tags.length) entry.tags = p.tags;
    if (p.cover) entry.cover = p.cover;
    if (p.draft) entry.draft = true;
    // Keep any extra authored keys we do not model, so hand-added fields
    // survive a build.
    for (const key of Object.keys(base)) {
      if (!(key in entry)) entry[key] = base[key];
    }
    return entry;
  });

  const json = JSON.stringify(out, null, 2) + "\n";
  emit(cfg.blog.manifest, json);
  return out;
}

// ---- output helpers -------------------------------------------------------

const written = new Map(); // relPath -> contents

/**
 * Queue a file for writing.
 *
 * Nothing touches disk until flush(). A build that failed halfway previously
 * left some regenerated pages sitting next to stale feeds, which is the worst
 * possible state: the site still works, but its metadata contradicts its
 * content. Errors now mean zero writes.
 */
function emit(relPath, contents) {
  written.set(relPath, contents);
}

function flush() {
  if (CHECK) {
    for (const [relPath, contents] of written) reportCheck(relPath, contents);
    return;
  }
  for (const [relPath, contents] of written) {
    const abs = path.join(ROOT, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const previous = exists(relPath) ? readText(relPath) : null;
    if (previous === contents) {
      if (VERBOSE) console.log(`  unchanged  ${relPath}`);
      continue;
    }
    fs.writeFileSync(abs, contents, "utf8");
    console.log(`  ${previous === null ? "created " : "updated "} ${relPath}`);
  }
}

function reportCheck(relPath, contents) {
  const current = exists(relPath) ? readText(relPath) : null;
  if (current === null) {
    errors.push(`${relPath}: not committed — run \`npm run build\` and commit the output`);
  } else if (current !== contents) {
    errors.push(`${relPath}: differs from build output — run \`npm run build\` and commit`);
  }
}

// ---- main -----------------------------------------------------------------

function main() {
  const dims = exists(cfg.build.imageManifest)
    ? JSON.parse(readText(cfg.build.imageManifest))
    : {};
  if (!Object.keys(dims).length) {
    warn(cfg.build.imageManifest, "missing or empty — run `python3 scripts/optimize-images.py` to regenerate");
  }

  const manifest = loadManifest();
  const seenSlugs = new Set();
  let posts = [];

  for (const entry of manifest) {
    if (!entry.slug) {
      fail(cfg.blog.manifest, `entry without a "slug": ${JSON.stringify(entry)}`);
      continue;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)) {
      fail(entry.path || cfg.blog.manifest, `slug "${entry.slug}" is not lowercase kebab-case`);
    }
    if (seenSlugs.has(entry.slug)) {
      fail(cfg.blog.manifest, `duplicate slug "${entry.slug}"`);
      continue;
    }
    seenSlugs.add(entry.slug);

    const post = parsePost(entry);
    if (post) posts.push(post);
  }

  // Orphan detection: a blog.md on disk that is not in posts.json will never
  // be published, which is an easy mistake after writing a new draft.
  if (exists(cfg.blog.outDir)) {
    for (const dir of fs.readdirSync(path.join(ROOT, cfg.blog.outDir), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const candidate = `${cfg.blog.outDir}/${dir.name}/blog.md`;
      if (exists(candidate) && !seenSlugs.has(dir.name)) {
        warn(candidate, `not listed in ${cfg.blog.manifest} — it will not be published`);
      }
    }
  }

  posts.sort((a, b) => (b.dateObj || 0) - (a.dateObj || 0));
  posts.forEach((p, i) => {
    validateReferences(p, dims);
    p.next = posts[i + 1] || null; // older
    p.prev = posts[i - 1] || null; // newer
  });

  for (const p of posts) {
    if (p.draft) {
      console.log(`  draft      ${p.slug} — skipped`);
      continue;
    }
    const pagePath = `${cfg.blog.outDir}/${p.slug}/index.html`;
    const bodyHTML = P.renderPostHTML(marked.parse(p.content), {
      pagePath,
      dims,
    });
    const toc = extractToc(bodyHTML);

    const html = T.postPage({
      slug: p.slug,
      title: p.title,
      description: p.description,
      date: p.date,
      updated: p.updated,
      dateLabel: new Date(p.dateObj).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      tags: p.tags,
      cover: p.cover,
      // og:/twitter: images must be PNG or JPEG: Facebook, WhatsApp, LinkedIn
      // and Twitter scrapers all fail to rasterize WebP.
      ogImage: p.cover,
      words: p.words,
      minutes: p.minutes,
      toc,
      bodyHTML: indent(bodyHTML, 20),
      outDir: cfg.blog.outDir,
      prev: p.prev && { slug: p.prev.slug, title: p.prev.title },
      next: p.next && { slug: p.next.slug, title: p.next.title },
    });

    emit(pagePath, html);

    const age = p.dateObj ? (Date.now() - p.dateObj.getTime()) / 86400000 : Infinity;
    if (age > cfg.blog.staleAfterDays) {
      warn(p.src, `published ${Math.round(age)} days ago — consider an update or a new post`);
    }
  }

  emit("404.html", T.notFoundPage());
  writeManifest(posts);
  emit(cfg.blog.feed.file, buildRss(posts));
  emit("atom.xml", buildAtom(posts));
  emit("sitemap.xml", buildSitemap(posts));
  emit("robots.txt", buildRobots());

  flush();

  // ---- summary ------------------------------------------------------------
  console.log(
    `\n${posts.length} post(s), ${written.size} file(s) ${CHECK ? "verified" : "written"}`
  );
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.log(`  ! ${w}`));
  }
  if (errors.length) {
    if (!CHECK) console.error("\nnothing was written: fix the errors above and rebuild");
    console.error(`\n${errors.length} error(s):`);
    errors.forEach((e) => console.error(`  x ${e}`));
    process.exitCode = 1;
    return;
  }
  if (CHECK) console.log("  all generated files match committed output");
}

function indent(html, spaces) {
  const pad = " ".repeat(spaces);
  return html
    .split("\n")
    .map((line) => (line.trim() ? pad + line : line))
    .join("\n");
}

main();
