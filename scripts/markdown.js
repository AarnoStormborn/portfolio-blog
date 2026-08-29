// scripts/markdown.js
//
// marked configuration for blog markdown, plus a raw-HTML policy.
//
// Why this is strict: posts are hand-authored, but "hand-authored" tends to
// become "pasted in from somewhere". marked passes raw HTML straight through,
// and the DOMPurify script the site used to load was never actually called —
// so a <script> tag in a .md file would have executed in the browser. The
// build therefore refuses to emit HTML it did not generate itself.
//
// This is build-time policy. The client-side fallback in assets/js/blog.js
// applies the same intent at runtime with DOMPurify.

const { Marked, Renderer } = require("marked");
const hljs = require("highlight.js");

// Raw HTML tolerated inside markdown. Tag names only: every attribute is
// stripped, because <img onerror=...> is how you smuggle a handler past a
// name-only whitelist.
const RAW_HTML_ALLOW = new Set(["br", "kbd", "sub", "sup", "details", "summary", "mark"]);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape any attribute-looking text and reduce an allow-listed tag to bare form. */
function bareTag(html) {
  return html.replace(/<\s*([a-zA-Z][\w-]*)\b[^>]*>/g, (_m, name) => `<${name.toLowerCase()}>`);
}

/**
 * marked's `html` renderer receives raw HTML blocks/inline spans verbatim.
 * Anything not on the allow list is escaped into visible text.
 */
function renderRawHTML(html) {
  const text = String(html);
  const tag = /^\s*<\/?\s*([a-zA-Z][\w-]*)/.exec(text);
  if (!tag) return escapeHtml(text); // an HTML comment, or stray "<"
  if (!RAW_HTML_ALLOW.has(tag[1].toLowerCase())) return escapeHtml(text);
  return bareTag(text);
}

/**
 * Build an isolated marked instance.
 *
 * Deliberately not marked.use(): that mutates the module-level singleton, so
 * any other require('marked') in the process would silently inherit this
 * renderer — including tests that want to assert on vanilla marked output.
 */
function createMarked() {
  const renderer = new Renderer();

  renderer.html = renderRawHTML;

  // Syntax highlighting at build time. Code blocks used to ship as plain <pre>
  // and every visitor downloaded marked.js to get nothing better.
  renderer.code = function (code, infostring) {
    const lang = String(infostring || "").trim().split(/\s+/)[0];
    let body;
    let cls = "language-plaintext";
    if (lang && hljs.getLanguage(lang)) {
      cls = `language-${lang} hljs`;
      body = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } else {
      body = escapeHtml(code);
    }
    const label = lang ? `<span class="code-lang" aria-hidden="true">${escapeHtml(lang)}</span>` : "";
    return `<div class="code-block">${label}<pre><code class="${cls}">${body}</code></pre></div>`;
  };

  // Give every external target its own rel; post-render adds the rest so this
  // stays the only place that decides link semantics.
  const instance = new Marked({
    renderer,
    gfm: true,
    breaks: false,
    pedantic: false,
    headerIds: false,
    mangle: false,
  });
  return instance;
}

/** md -> HTML with the raw-HTML policy applied and code highlighted. */
function toHTML(md) {
  return createMarked().parse(md);
}
module.exports = { createMarked, toHTML, renderRawHTML, RAW_HTML_ALLOW, escapeHtml };
