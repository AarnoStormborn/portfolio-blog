// scripts/templates.js
//
// Markup for the pages build.js generates: one static page per blog post, plus
// the 404 page. index.html and blog.html stay hand-written (they are bespoke
// design surfaces), but they reuse the same partials by including the same
// nav/footer markup — see the "keep in sync" notes in those files.
//
// Every generated page is written relative to its own directory, so asset and
// link hrefs go through `rel()` rather than being hardcoded.

const cfg = require("./site.config");

const SITE = cfg.site;

/** HTML-escape for text nodes. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape for use inside an attribute value that is already quoted. */
function attr(s) {
  return esc(s);
}

/**
 * Express a root-relative path as seen from `fromPage`.
 * Duplicated logic from assets/js/post-render.js on purpose: templates run at
 * build time only, and we do not want to require browser code here.
 */
function rel(fromPage, target) {
  const P = require("../assets/js/post-render.js");
  return P.relativeFrom(fromPage, target);
}

function absolute(target) {
  return SITE.url.replace(/\/$/, "") + "/" + target.replace(/^\//, "");
}

// ---- icons ----------------------------------------------------------------

const ICONS = {
  github:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>',
  x: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>',
  linkedin:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>',
  sun: '<svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>',
  moon: '<svg class="icon-moon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
};

// ---- partials -------------------------------------------------------------

function analytics(base) {
  if (!cfg.analytics.enabled) return "";
  const host = `https://${cfg.analytics.code}.goatcounter.com/count`;
  // No data-goatcounter-settings: GoatCounter already filters local addresses
  // (localhost, 127.0.0.1, 192.168.x) unless you explicitly pass
  // {"allow_local": true}, which is the only key in that area. The previous
  // version of this snippet passed {"skip_local": true} — a key that does not
  // exist in the docs, silently ignored by count.js.
  return `    <!-- GoatCounter: cookieless analytics. Counter code lives in
         scripts/site.config.js under analytics.code. -->
    <script data-goatcounter="${attr(host)}" async src="//gc.zgo.at/count.js"></script>`;
}

function nav(pagePath, active) {
  const links = cfg.nav.items
    .map((item) => {
      const href = rel(pagePath, item.href);
      const current = active === item.id ? ' aria-current="true"' : "";
      return `                    <li class="nav-item"><a class="nav-link${
        active === item.id ? " active" : ""
      }" href="${attr(href)}"${current}>${esc(item.label)}</a></li>`;
    })
    .join("\n");

  const blogHref = rel(pagePath, "blog.html");
  const blogActive = active === "blog" ? ' aria-current="page"' : "";

  return `    <nav class="navbar navbar-expand-lg sticky-top" aria-label="Main navigation">
        <div class="container">
            <a class="navbar-brand" href="${attr(rel(pagePath, "index.html"))}" aria-label="${attr(
    SITE.name
  )} — home">
                <picture>
                    <source type="image/webp" srcset="${attr(rel(pagePath, "assets/images/nav-logo.webp"))}">
                    <img id="nav-logo" src="${attr(rel(pagePath, "assets/images/nav-logo.png"))}" alt="${attr(
    SITE.name
  )} logo" width="180" height="180" fetchpriority="high">
                </picture>
            </a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav"
                aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarNav">
                <ul class="navbar-nav ms-auto align-items-center">
${links}
                    <li class="nav-item"><a class="nav-link nav-link-blog${
                      active === "blog" ? " active" : ""
                    }" href="${attr(blogHref)}"${blogActive}>Blog</a></li>
                    <li class="nav-item ms-lg-3">
                        <button id="theme-toggle" class="btn btn-link nav-link theme-toggle" type="button"
                            aria-label="Toggle dark mode" aria-pressed="false">
                            ${ICONS.sun}
                            ${ICONS.moon}
                        </button>
                    </li>
                </ul>
            </div>
        </div>
    </nav>`;
}

function socialRow(pagePath) {
  const items = [
    ["github", cfg.social.github, "GitHub"],
    ["x", cfg.social.x, "X (Twitter)"],
    ["linkedin", cfg.social.linkedin, "LinkedIn"],
  ]
    .map(
      ([key, href, label]) =>
        `            <a href="${attr(href)}" class="social-icon" target="_blank" rel="noopener noreferrer" aria-label="${attr(
          label
        )}">${ICONS[key]}</a>`
    )
    .join("\n");
  return `        <div class="social-icons mb-3">\n${items}\n        </div>`;
}

function footer(pagePath) {
  // Ship the current year as static fallback text, and let theme.js refresh
  // [data-year]. Committed output would otherwise freeze at whenever the last
  // `npm run build` happened.
  const year = new Date().getFullYear();
  return `    <footer class="text-center py-4 mt-5">
${socialRow(pagePath)}
        <p class="text-muted">&copy; <span data-year>${year}</span> ${esc(SITE.name)} · <a href="${attr(
    rel(pagePath, "blog.html")
  )}">Blog</a> · <a href="${attr(rel(pagePath, "feed.xml"))}">RSS</a></p>
    </footer>`;
}

/**
 * Set the theme attribute before first paint.
 *
 * Must be inline. It cannot live in <head>: the CSS keys off
 * body[data-theme='dark'], and document.body does not exist while <head> is
 * still parsing. Placing it immediately after the opening <body> tag means the
 * attribute is set before any content paints, so dark-mode visitors do not see
 * a white flash. theme.js handles everything after that.
 */
function themeBootstrap() {
  return `    <!-- Applied before first paint so dark mode does not flash white.
         Keep in sync with assets/js/theme.js. -->
    <script>
        (function () {
            try {
                var saved = localStorage.getItem('theme');
                var dark = saved === 'dark' ||
                    (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
                if (dark) document.body.setAttribute('data-theme', 'dark');
            } catch (e) { /* private mode: stay on the system default */ }
        })();
    </script>`;
}

function head(pagePath, opts) {
  const title = opts.title;
  const description = opts.description || SITE.description;
  const canonical = opts.canonical || absolute(opts.pageUrl || "");
  const image = opts.image ? absolute(opts.image) : absolute(SITE.defaultOgImage);
  const favicon = rel(pagePath, "assets/images/tab-icon.png");
  const stylesheet = rel(pagePath, "assets/css/style.css");
  const preload = opts.preload
    ? `\n    <link rel="preload" as="font" type="font/woff2" crossorigin href="${attr(
        opts.preload
      )}">`
    : "";

  const meta = [`    <title>${esc(title)}</title>`, `    <meta name="description" content="${attr(description)}">`];

  if (opts.keywords) {
    meta.push(`    <meta name="keywords" content="${attr(opts.keywords)}">`);
  }
  meta.push(
    `    <meta name="author" content="${attr(SITE.author)}">`,
    `    <meta name="color-scheme" content="light dark">`,
    `    <meta name="theme-color" content="${attr(SITE.themeColor)}">`,
    `    <link rel="canonical" href="${attr(canonical)}">`,
    ``,
    `    <meta property="og:type" content="${opts.ogType || "website"}">`,
    `    <meta property="og:site_name" content="${attr(SITE.name)}">`,
    `    <meta property="og:locale" content="${attr(SITE.locale)}">`,
    `    <meta property="og:title" content="${attr(title)}">`,
    `    <meta property="og:description" content="${attr(description)}">`,
    `    <meta property="og:url" content="${attr(canonical)}">`,
    `    <meta property="og:image" content="${attr(image)}">`,
    `    <meta name="twitter:card" content="${opts.largeImage ? "summary_large_image" : "summary"}">`,
    `    <meta name="twitter:title" content="${attr(title)}">`,
    `    <meta name="twitter:description" content="${attr(description)}">`,
    `    <meta name="twitter:image" content="${attr(image)}">`,
    `    <meta name="twitter:site" content="@TheGlobalMinima">`,
    `    <meta name="twitter:creator" content="@TheGlobalMinima">`
  );

  if (opts.jsonLd) {
    meta.push(
      ``,
      `    <script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>`
    );
  }

  return `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
${meta.join("\n")}${preload}
    <link rel="icon" type="image/png" href="${attr(favicon)}">
    <link rel="apple-touch-icon" href="${attr(rel(pagePath, "assets/images/logo.png"))}">
    <link rel="alternate" type="application/rss+xml" title="${attr(cfg.blog.feed.title)}" href="${attr(
    rel(pagePath, "feed.xml")
  )}">
    <!-- Bootstrap first, then our sheet, so our overrides win by order as well
         as specificity. The generated navbar/container/grid markup depends on
         this: omitting it leaves .container without its max-width and centers
         nothing. -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="${attr(stylesheet)}">
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" defer></script>
${analytics(pagePath)}
</head>`;
}

// ---- pages ----------------------------------------------------------------

function postPage(ctx) {
  const pagePath = `${ctx.outDir}/${ctx.slug}/index.html`;
  const bodyClass = "page-post";
  // PNG/JPEG only — see the note in build.js about WebP and social scrapers.
  const ogImage = ctx.ogImage || ctx.cover || SITE.defaultOgImage;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: ctx.title,
    description: ctx.description,
    inLanguage: "en",
    datePublished: isoDate(ctx.date),
    ...(ctx.updated ? { dateModified: isoDate(ctx.updated) } : {}),
    wordCount: ctx.words || undefined,
    keywords: (ctx.tags || []).join(", ") || undefined,
    author: {
      "@type": "Person",
      name: SITE.author,
      url: absolute("index.html"),
      sameAs: [cfg.social.github, cfg.social.x, cfg.social.linkedin],
    },
    publisher: {
      "@type": "Person",
      name: SITE.author,
      logo: { "@type": "ImageObject", url: absolute(SITE.defaultOgImage) },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": absolute(`${ctx.outDir}/${ctx.slug}/`) },
    ...(ctx.cover ? { image: absolute(ogImage) } : {}),
  };

  const toc = ctx.toc && ctx.toc.length
    ? `                <nav class="post-toc mb-4" aria-label="Table of contents">
                    <h2 class="post-toc-title">Contents</h2>
                    <ol class="post-toc-list">
${ctx.toc
  .map(
    (t) =>
      `                        <li class="toc-depth-${t.depth}"><a href="#${attr(t.id)}">${esc(t.text)}</a></li>`
  )
  .join("\n")}
                    </ol>
                </nav>`
    : "";

  const tags = ctx.tags && ctx.tags.length
    ? `                    <p class="post-tags">${ctx.tags
        .map(
          (t) =>
            `<a class="post-tag" href="${attr(
              rel(pagePath, "blog.html")
            )}?tag=${encodeURIComponent(t)}" rel="tag">${esc(t)}</a>`
        )
        .join(" ")}</p>`
    : "";

  return `${head(pagePath, {
    title: `${ctx.title} — ${SITE.name}`,
    description: ctx.description,
    pageUrl: `${ctx.outDir}/${ctx.slug}/`,
    image: ogImage,
    largeImage: Boolean(ctx.cover),
    ogType: "article",
    keywords: (ctx.tags || []).join(", "),
    jsonLd,
    preload: rel(pagePath, "assets/fonts/jost-latin.woff2"),
  })}

<body class="${bodyClass}">
${themeBootstrap()}
${nav(pagePath, "blog")}

    <main class="container my-5" id="main">
        <div class="post-shell">
            <article class="post-article">
                <header class="post-header">
                    <a class="post-back" href="${attr(rel(pagePath, "blog.html"))}">&larr; All posts</a>
                    <h1 class="post-title display-5 fw-bold">${esc(ctx.title)}</h1>
                    <p class="post-meta">
                        <time datetime="${attr(isoDate(ctx.date))}">${esc(ctx.dateLabel)}</time>
                        <span class="post-meta-sep" aria-hidden="true">·</span>
                        <span>${ctx.minutes} min read</span>
                    </p>
${tags}
                </header>
${toc}
                <div class="post-body" id="post-body">
${ctx.bodyHTML}
                </div>
            </article>

            <aside class="post-rail">
                <div class="post-author-card">
                    <picture>
                        <source type="image/webp" srcset="${attr(rel(pagePath, "assets/images/dp.webp"))}">
                        <img src="${attr(rel(pagePath, "assets/images/dp.png"))}" alt="" width="500" height="500"
                            loading="lazy" decoding="async">
                    </picture>
                    <div>
                        <strong>${esc(SITE.author)}</strong>
                        <p>AI engineering, agents, and the messy middle of shipping ML.</p>
                        <a href="${attr(rel(pagePath, "index.html"))}">About me</a>
                    </div>
                </div>
${
  ctx.prev || ctx.next
    ? `                <nav class="post-pager" aria-label="More posts">
${
  ctx.prev
    ? `                    <a class="pager pager-prev" href="${attr(
        rel(pagePath, `${ctx.outDir}/${ctx.prev.slug}/index.html`)
      )}"><span>Newer</span><strong>${esc(ctx.prev.title)}</strong></a>`
    : ""
}${
    ctx.next
      ? `                    <a class="pager pager-next" href="${attr(
          rel(pagePath, `${ctx.outDir}/${ctx.next.slug}/index.html`)
        )}"><span>Older</span><strong>${esc(ctx.next.title)}</strong></a>`
      : ""
}
                </nav>`
    : ""
}
            </aside>
        </div>
    </main>

${footer(pagePath)}

    <script src="${attr(rel(pagePath, "assets/js/theme.js"))}"></script>
</body>

</html>
`;
}

function notFoundPage() {
  const pagePath = "404.html";
  return `${head(pagePath, {
    title: `404 — page not found · ${SITE.name}`,
    description: "That page does not exist. Links to the portfolio and blog instead.",
    pageUrl: "404.html",
  })}

<body class="page-404">
${themeBootstrap()}
${nav(pagePath, "")}

    <main class="container my-5" id="main">
        <div class="notfound text-center">
            <p class="notfound-code" aria-hidden="true">404</p>
            <h1 class="display-6 fw-bold">Nothing here yet</h1>
            <p class="text-secondary">The page you wanted moved, or never existed. Try the blog or the portfolio.</p>
            <p class="mt-4">
                <a class="btn btn-primary" href="${attr(rel(pagePath, "blog.html"))}">Read the blog</a>
                <a class="btn btn-outline-primary ms-2" href="${attr(rel(pagePath, "index.html"))}">Go home</a>
            </p>
        </div>
    </main>

${footer(pagePath)}

    <script src="${attr(rel(pagePath, "assets/js/theme.js"))}"></script>
</body>

</html>
`;
}

function isoDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

module.exports = {
  esc,
  attr,
  rel,
  absolute,
  head,
  nav,
  footer,
  socialRow,
  themeBootstrap,
  postPage,
  notFoundPage,
  ICONS,
};
