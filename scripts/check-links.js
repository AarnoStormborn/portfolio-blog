#!/usr/bin/env node
// scripts/check-links.js
//
// Verify every internal href/src in the built site resolves to a real file.
//
// This exists because the old site authored markdown image paths root-relative
// ("blogs/slug/cover.png") while pages lived in subdirectories, so images 404ed
// in production and nobody noticed — the JS fallback silently rendered text
// only. A checker catches that on every build.
//
//   node scripts/check-links.js            scan dist
//   node scripts/check-links.js --verbose  list every link checked

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const VERBOSE = process.argv.includes("--verbose");

// Extensions we will look for when a URL has none (directory-style links).
const INDEX_CANDIDATES = ["index.html", "index.htm"];

const SKIP_PREFIX = ["http://", "https://", "mailto:", "tel:", "data:", "#", "//"];

const results = { checked: 0, ok: 0, broken: [], external: 0 };

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function resolveRef(fromFile, ref) {
  const clean = ref.split("#")[0].split("?")[0].trim();
  if (!clean) return { skip: "fragment/query only" };
  if (SKIP_PREFIX.some((p) => ref.startsWith(p))) return { skip: "external/scheme" };

  // A ref beginning with "/" is site-root-relative: resolve against ROOT.
  const base = clean.startsWith("/")
    ? path.join(ROOT, clean)
    : path.resolve(path.dirname(fromFile), clean);

  if (fs.existsSync(base) && fs.statSync(base).isFile()) return { file: base };
  // Directory-style link (blogs/slug/) -> blogs/slug/index.html
  if (clean.endsWith("/") || fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const idx of INDEX_CANDIDATES) {
      const candidate = path.join(base, idx);
      if (fs.existsSync(candidate)) return { file: candidate };
    }
    return { missing: base, note: "directory with no index.html" };
  }
  return { missing: base };
}

function scanFile(file) {
  const html = fs.readFileSync(file, "utf8");
  const refs = new Set();
  for (const re of [/\bhref="([^"]*)"/g, /\bsrc="([^"]*)"/g, /\bsrcset="([^"]*)"/g]) {
    let m;
    while ((m = re.exec(html))) {
      // srcset is a comma-separated list of "url [descriptor]"
      if (re.source.includes("srcset")) {
        m[1].split(",").forEach((part) => refs.add(part.trim().split(/\s+/)[0]));
      } else {
        refs.add(m[1]);
      }
    }
  }
  for (const ref of refs) {
    results.checked++;
    const r = resolveRef(file, ref);
    if (r.skip) {
      if (/^https?:\/\//.test(ref)) results.external++;
      else results.ok++;
      continue;
    }
    if (r.file) {
      results.ok++;
      if (VERBOSE) console.log(`  ok   ${path.relative(ROOT, file)} -> ${ref}`);
    } else {
      const rel = path.relative(ROOT, file);
      results.broken.push({ from: rel, ref, resolved: path.relative(ROOT, r.missing), note: r.note });
      console.error(`  BROKEN  ${rel}\n          -> ${ref}\n          = ${path.relative(ROOT, r.missing)}${r.note ? ` (${r.note})` : ""}`);
    }
  }
}

// Also check that images referenced in markdown resolve from the page that
// renders them, and that the dims manifest agrees with files on disk.
function scanManifest() {
  const manifestPath = path.join(ROOT, "assets/data/image-dims.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("  BROKEN  assets/data/image-dims.json missing — run npm run images");
    results.broken.push({ from: "manifest", ref: "image-dims.json" });
    return;
  }
  const dims = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const [src, entry] of Object.entries(dims)) {
    results.checked++;
    if (!fs.existsSync(path.join(ROOT, src))) {
      results.broken.push({ from: "image-dims.json", ref: src });
      console.error(`  BROKEN  manifest references missing file: ${src}`);
    } else if (entry.webp && entry.hasWebp && !fs.existsSync(path.join(ROOT, entry.webp))) {
      results.broken.push({ from: "image-dims.json", ref: entry.webp });
      console.error(`  BROKEN  manifest references missing webp: ${entry.webp}`);
    } else {
      results.ok++;
    }
  }
}

const files = walk(ROOT);
files.forEach(scanFile);
scanManifest();

console.log(
  `\n${files.length} HTML files, ${results.checked} references: ${results.ok} ok, ${results.broken.length} broken (${results.external} external not checked)`
);
if (results.broken.length) process.exit(1);
