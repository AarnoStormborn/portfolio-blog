// assets/js/blog.js
//
// Client-side renderer for the blog.
//
// Two jobs, and neither is the primary way posts are served any more:
//
//   1. blog.html — build the post list from posts.json.
//   2. post.html?post=<slug> — render a post that has no static page.
//
// Published posts are pre-rendered to blogs/<slug>/index.html by
// scripts/build.js, so a real URL, correct og: tags and crawlable text exist
// without JavaScript. This file is the fallback that path does not cover:
// a draft .md that has not been built yet, or viewing a post from a local
// file:// preview. blog.js therefore links to the static page when the manifest
// says one exists, and only falls back to post.html otherwise.
//
// HTML comes from PostRender (assets/js/post-render.js), the same module the
// build uses, so both render paths produce identical markup. DOMPurify is
// applied here because this path executes untrusted-ish markdown in a browser;
// the build path enforces its own policy in scripts/markdown.js.

(function () {
  "use strict";

  const CONTAINER_LIST = "blog-posts-container";
  const CONTAINER_POST = "post-content";

  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById(CONTAINER_LIST)) loadBlogPosts();
    if (document.getElementById(CONTAINER_POST)) loadSinglePost();
  });

  // ---- helpers ------------------------------------------------------------

  async function fetchJSON(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    return response.json();
  }

  function formatDate(iso) {
    const date = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
    if (Number.isNaN(date.getTime())) return String(iso);
    return date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
  }

  /**
   * Sanitize markdown-derived HTML.
   *
   * DOMPurify was already loaded on these pages by an earlier "safety checks"
   * commit but was never actually called, so it protected nothing. Now that it
   * is called: do NOT override ALLOWED_URI_REGEXP. DOMPurify's default already
   * permits relative URLs and rejects javascript:/data:, and a custom regexp
   * that only lists scheme-anchored prefixes silently strips every relative
   * src/srcset — which is exactly how this file's first version blanked out all
   * five images on the fallback page.
   *
   * If DOMPurify is missing (CDN blocked) we degrade to escaping everything
   * rather than injecting raw HTML: a broken page beats an XSS.
   */
  function sanitize(html) {
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
      return window.DOMPurify.sanitize(html, {
        // picture/source pass the default profile already; these extras cover
        // the loading hints post-render.js adds.
        ADD_ATTR: ["srcset", "loading", "decoding", "fetchpriority"],
      });
    }
    console.error("DOMPurify unavailable — rendering post as escaped text");
    const div = document.createElement("div");
    div.textContent = html;
    return div.innerHTML;
  }

  /**
   * Where a post lives: its pre-rendered page if published, else post.html.
   *
   * manifest.staticUrl is page-relative ("blogs/<slug>/"), so it works from any
   * root-level page. Prefixing "./" makes that explicit and keeps it correct if
   * this renderer is ever used from a page inside a subdirectory.
   */
  function postHref(post) {
    if (post.staticUrl) {
      return post.staticUrl.charAt(0) === "/" || /^https?:/i.test(post.staticUrl)
        ? post.staticUrl
        : "./" + post.staticUrl;
    }
    return `post.html?post=${encodeURIComponent(post.slug)}`;
  }

  // ---- listing ------------------------------------------------------------

  async function loadBlogPosts() {
    const container = document.getElementById(CONTAINER_LIST);
    try {
      const posts = await fetchJSON("posts.json");
      container.innerHTML = "";

      if (!Array.isArray(posts) || posts.length === 0) {
        container.innerHTML =
          '<div class="col-12"><p class="text-center text-secondary">No posts yet. Coming soon!</p></div>';
        return;
      }

      const sorted = posts
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

      // Post pages link their tags to blog.html?tag=<name>, so the query has to
      // mean something here. Filtering client-side keeps posts.json the single
      // source of truth; a static per-tag index would need one page per tag.
      const wanted = new URLSearchParams(window.location.search).get("tag");
      const shown = wanted
        ? sorted.filter((p) => (p.tags || []).some((t) => String(t).toLowerCase() === wanted.toLowerCase()))
        : sorted;

      if (wanted) {
        container.appendChild(filterBanner(wanted, shown.length, sorted.length));
      }
      if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "col-12";
        empty.innerHTML = `<p class="text-center text-secondary">No posts tagged
          &ldquo;${escapeText(wanted)}&rdquo; yet.</p>`;
        container.appendChild(empty);
        return;
      }
      shown.forEach((post) => container.appendChild(buildCard(post)));
    } catch (error) {
      console.error("Failed to load blog posts:", error);
      container.innerHTML =
        '<div class="col-12"><p class="text-center text-danger">Could not load posts. Please try again later.</p></div>';
    }
  }

  function filterBanner(tag, shown, total) {
    const wrap = document.createElement("div");
    wrap.className = "col-12";
    wrap.innerHTML = `<div class="filter-bar">
      <span>Filtered by tag <strong>${escapeText(tag)}</strong> — ${shown} of ${total} post${
      total === 1 ? "" : "s"
    }</span>
      <a class="filter-clear" href="${location.pathname}">Show all</a>
    </div>`;
    return wrap;
  }

  function buildCard(post) {
    const col = document.createElement("div");
    col.className = "col-12";

    const href = postHref(post);
    const meta = [
      `<time datetime="${escapeAttr(String(post.date).slice(0, 10))}">${escapeText(
        formatDate(post.date)
      )}</time>`,
    ];
    if (post.readingTime) meta.push(`<span>${escapeText(String(post.readingTime) + " min read")}</span>`);
    if (post.tags && post.tags.length) {
      // Tags link back into the filtered view of this same page.
      meta.push(
        ...post.tags.map(
          (t) =>
            `<a class="post-tag" href="${escapeAttr(
              location.pathname
            )}?tag=${encodeURIComponent(t)}">${escapeText(String(t))}</a>`
        )
      );
    }

    col.innerHTML = `
      <article class="card post-card p-4">
        <div class="card-body">
          <h2 class="card-title"><a class="card-link-stretch" href="${escapeAttr(href)}">${escapeText(
      post.title
    )}</a></h2>
          <p class="post-card-meta">${meta.join('<span aria-hidden="true">·</span>')}</p>
          <p class="card-text">${escapeText(post.summary || "")}</p>
        </div>
      </article>`;
    return col;
  }

  // ---- single post --------------------------------------------------------

  async function loadSinglePost() {
    const target = document.getElementById(CONTAINER_POST);
    try {
      const slug = new URLSearchParams(window.location.search).get("post");
      if (!slug) throw new Error("No post specified in the URL.");

      const posts = await fetchJSON("posts.json");
      const post = posts.find((p) => p.slug === slug);
      if (!post) throw new Error(`Post "${slug}" not found.`);

      document.title = `${post.title} — Harsh Singh`;

      const titleEl = document.getElementById("post-title");
      const dateEl = document.getElementById("post-date");
      if (titleEl) titleEl.textContent = post.title;
      if (dateEl) dateEl.textContent = formatDate(post.date);

      const mdResponse = await fetch(post.path, { cache: "no-cache" });
      if (!mdResponse.ok) throw new Error(`Could not read ${post.path} (${mdResponse.status}).`);
      const markdown = await mdResponse.text();

      const dims = await fetchJSON("assets/data/image-dims.json").catch(() => ({}));

      const raw = window.marked ? window.marked.parse(stripFrontMatter(markdown)) : "";
      const rendered = window.PostRender
        ? window.PostRender.renderPostHTML(raw, { pagePath: "post.html", dims })
        : raw;

      target.innerHTML = sanitize(rendered);
    } catch (error) {
      console.error("Failed to load the post:", error);
      target.innerHTML = `<p class="text-center text-danger">Could not load this post: ${escapeText(
        error.message
      )}</p>`;
    }
  }

  /** The build strips front matter; the fallback fetches the raw file. */
  function stripFrontMatter(text) {
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  }

  function escapeText(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  }

  function escapeAttr(s) {
    return escapeText(s).replace(/"/g, "&quot;");
  }
})();
