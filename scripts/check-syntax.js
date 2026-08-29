// scripts/check-syntax.js
//
// Cheap structural validation for the files a browser would only complain about
// silently: unbalanced CSS braces, and JSON-LD that will not parse.
//
// Why: CSS has no parser here, and a single stray "}" makes the browser close
// the current block early, so every rule after it is quietly dropped while the
// page still looks like it loaded fine. This caught a real one during the
// redesign: an orphaned `.heading-anchor { display: none }` outside its media
// query, and 150 lines of responsive CSS living in no block at all.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

const CSS = [
  "assets/css/style.css",
];

// Discover HTML rather than listing it, so a newly published post is checked
// without someone having to remember to update this array.
function findHtml(dir, acc = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return acc;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) findHtml(rel, acc);
    else if (entry.name.endsWith(".html")) acc.push(rel);
  }
  return acc;
}

const HTML = findHtml(".").sort();

const JSON_FILES = ["posts.json", "assets/data/image-dims.json", "assets/images/tech/manifest.json"];

let failures = 0;
const fail = (m) => {
  failures++;
  console.error(`  ✗ ${m}`);
};

/**
 * Count braces, ignoring comments and quoted strings.
 * Returns the line of the first unbalanced close, or -1.
 */
function scanBraces(text) {
  const out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  let depth = 0;
  let firstNegative = -1;
  let line = 1;
  let inString = null;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (ch === "\n") {
      line++;
      if (inString) inString = null; // unterminated string across a line: bail out
      continue;
    }
    if (inString) {
      if (ch === inString && out[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) {
        if (firstNegative === -1) firstNegative = line;
        depth = 0; // keep scanning for more damage
      }
    }
  }
  return { depth, firstNegative };
}

console.log("check-syntax");

for (const file of CSS) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    fail(`${file}: missing`);
    continue;
  }
  const { depth, firstNegative } = scanBraces(fs.readFileSync(full, "utf8"));
  if (firstNegative !== -1) fail(`${file}: stray "}" at line ${firstNegative} — rules after it fall outside their block`);
  else if (depth > 0) fail(`${file}: ${depth} unclosed "{" block(s) at end of file`);
  else console.log(`  ok   ${file}: braces balanced`);
}

for (const file of JSON_FILES) {
  const full = path.join(ROOT, file);
  try {
    JSON.parse(fs.readFileSync(full, "utf8"));
    console.log(`  ok   ${file}: valid JSON`);
  } catch (e) {
    fail(`${file}: ${e.message}`);
  }
}

for (const file of HTML) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    fail(`${file}: missing — run \`npm run build\``);
    continue;
  }
  const html = fs.readFileSync(full, "utf8");
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const [, body] of blocks) {
    try {
      const data = JSON.parse(body);
      // A JSON-LD graph that parses but has no @type is useless to a crawler.
      const types = Array.isArray(data) ? data.map((d) => d["@type"]) : [data["@type"]];
      if (!types.every(Boolean)) fail(`${file}: JSON-LD entry missing @type (${types.join(",")})`);
    } catch (e) {
      fail(`${file}: JSON-LD does not parse — ${e.message}`);
    }
  }
  // Every <a href="#x"> must have a target, or the nav link does nothing.
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const [, frag] of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(frag) && frag !== "main") fail(`${file}: href="#${frag}" has no matching id`);
  }
  console.log(`  ok   ${file}: ${blocks.length} JSON-LD block(s), ${ids.size} ids`);
}

// Every JS file must at least parse.
for (const file of ["assets/js/theme.js", "assets/js/blog.js", "assets/js/post-render.js", "scripts/build.js", "scripts/templates.js", "scripts/markdown.js"]) {
  try {
    new vm.Script(fs.readFileSync(path.join(ROOT, file), "utf8"), { filename: file });
    console.log(`  ok   ${file}: parses`);
  } catch (e) {
    fail(`${file}: ${e.message}`);
  }
}

console.log(failures === 0 ? "\nall syntax checks passed" : `\n${failures} syntax failure(s)`);
process.exit(failures ? 1 : 0);
