// assets/js/theme.js
//
// Dark mode + two navigation behaviours (navbar shadow, active section) +
// scroll reveal.
//
// Theme state is a single attribute on <body>: [data-theme='dark']. The CSS in
// style.css owns which theme-toggle icon is visible, so this file no longer
// touches the sun/moon SVG classes — the right icon shows even when JS is slow
// or disabled, and there is one less thing to keep in sync.
//
// The *initial* attribute is set by a small inline script in each page's <head>
// (see the theme-bootstrap block), because a deferred script at the end of
// <body> paints the light theme first and then flips — a visible white flash on
// every dark-mode page load. This file only handles interaction after paint.

(() => {
  const STORAGE_KEY = "theme";
  const body = document.body;

  /** Explicit choice wins; otherwise follow the OS. */
  const initialTheme = () => {
    let saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      // Private mode / blocked storage: fall through to system preference.
    }
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const apply = (theme) => {
    if (theme === "dark") {
      body.setAttribute("data-theme", "dark");
    } else {
      body.removeAttribute("data-theme");
    }
    const button = document.getElementById("theme-toggle");
    if (button) {
      button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    }
    syncMetaThemeColor(theme);
  };

  // Let the browser paint the right UI chrome (address bar, form controls)
  // before and after a toggle.
  const syncMetaThemeColor = (theme) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#120F21" : "#FFFFFF");
    }
  };

  let current =
    body.getAttribute("data-theme") === "dark" ? "dark" : initialTheme();
  apply(current);

  // Only re-apply on OS changes the user has not overridden.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = (event) => {
    let stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      stored = null;
    }
    if (stored === "dark" || stored === "light") return;
    apply(event.matches ? "dark" : "light");
  };
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onSystemChange);
  } else if (typeof media.addListener === "function") {
    media.addListener(onSystemChange); // Safari < 14
  }

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("theme-toggle");
    if (button) {
      button.addEventListener("click", () => {
        current = body.getAttribute("data-theme") === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(STORAGE_KEY, current);
        } catch (e) {
          /* storage unavailable: the toggle still works for this page view */
        }
        apply(current);
      });
      button.setAttribute("aria-pressed", current === "dark" ? "true" : "false");
    }

    initNavbarShadow();
    initActiveSectionHighlight();
    initReveal();
    initFooterYear();
  });

  // ---- footer year -------------------------------------------------------

  // The copyright year was hardcoded to 2025 while posts are dated 2026, so the
  // site looked unmaintained. Markup ships a real year as the fallback (crawlers
  // and no-JS visitors see that); this keeps it current without an edit.
  function initFooterYear() {
    const year = String(new Date().getFullYear());
    document.querySelectorAll("[data-year]").forEach((el) => {
      el.textContent = year;
    });
  }

  // ---- navbar depth ------------------------------------------------------

  function initNavbarShadow() {
    const navbar = document.querySelector(".navbar");
    if (!navbar) return;
    const onScroll = () => {
      navbar.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ---- active section ----------------------------------------------------

  // The nav links point at #about/#experience/#projects/#contact but nothing
  // ever marked them active, so you could be halfway down the page with no idea
  // where you were. Highlight whichever section owns the reading position.
  function initActiveSectionHighlight() {
    const links = new Map();
    document.querySelectorAll('.nav-link[href*="#"]').forEach((link) => {
      const id = link.getAttribute("href").split("#")[1];
      const section = id && document.getElementById(id);
      if (section) links.set(section, link);
    });
    if (!links.size || !("IntersectionObserver" in window)) return;

    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        });
        // Walk in document order and light the first visible section, so two
        // overlapping sections never both look active.
        let active = null;
        links.forEach((link, section) => {
          if (!active && visible.has(section)) active = link;
        });
        links.forEach((link) => {
          link.classList.toggle("active", link === active);
          if (link === active) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      },
      // A thin band near the top of the viewport counts as "the section you are
      // reading"; a full-viewport threshold fires far too late on long sections.
      { rootMargin: "-25% 0px -60% 0px", threshold: 0 }
    );

    links.forEach((_link, section) => observer.observe(section));
  }

  // ---- scroll reveal -----------------------------------------------------

  // Sections fade up as they enter the viewport. Elements are visible by
  // default in CSS and only hidden once .reveal-pending is added here, so a JS
  // failure (or an unobserved element) can never leave the page blank.
  function initReveal() {
    const targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;
    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      targets.forEach((el) => el.classList.add("is-revealed"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );
    targets.forEach((el) => el.classList.add("reveal-pending"));
    targets.forEach((el) => observer.observe(el));
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
})();
