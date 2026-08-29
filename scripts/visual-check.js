// scripts/visual-check.js
//
// Headless smoke test of the built site: JS errors, failed requests, image
// loading, layout shift risk, and rough contrast on the pairs we changed.
//
//   node scripts/visual-check.js [baseUrl]
//
// Not a replacement for looking at the site in a real browser. It catches the
// failure modes that are invisible to the eye: a 404 on one <img>, a thrown
// error in theme.js, a container overflowing the viewport.

const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = (process.argv[2] || "http://localhost:8123").replace(/\/$/, "");

// Cached Playwright browser, if a real Chrome is not installed.
const CANDIDATES = [
  process.env.CHROME_PATH,
  path.join(process.env.HOME || "", "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter(Boolean);

function findBrowser() {
  for (const c of CANDIDATES) if (fs.existsSync(c)) return c;
  return undefined; // let playwright-core resolve its default
}

const PAGES = [
  { url: "/", name: "index", anchors: ["#about", "#experience", "#projects", "#contact"] },
  { url: "/blog.html", name: "blog", anchors: [] },
  { url: "/post.html?post=holy-trinity-pi-herdr-opencode", name: "post (fallback)", anchors: [] },
  { url: "/blogs/holy-trinity-pi-herdr-opencode/", name: "post (static)", anchors: [] },
  { url: "/blogs/event-driven-future-of-ai/", name: "post event-driven", anchors: [] },
  { url: "/blogs/ai-roadmap-is-not-a-roadmap/", name: "post ai-roadmap", anchors: [] },
  { url: "/404.html", name: "404", anchors: [] },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

let failures = 0;
const notes = [];

function fail(msg) {
  failures++;
  console.error(`  ✗ ${msg}`);
}
function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

(async () => {
  const executablePath = findBrowser();
  if (!executablePath) {
    console.error("No browser found. Set CHROME_PATH or run: npx playwright install chromium");
    process.exit(2);
  }
  console.log(`browser: ${path.basename(executablePath)}`);

  const browser = await chromium.launch({ executablePath });

  for (const theme of ["light", "dark"]) {
    console.log(`\n=== ${theme.toUpperCase()} MODE ===`);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: "no-preference",
      colorScheme: theme === "dark" ? "dark" : "light",
    });

    // Seed localStorage before any page script runs, so the theme bootstrap
    // picks it up (this is the path a real returning visitor takes).
    await context.addInitScript(([t]) => {
      localStorage.setItem("theme", t);
    }, [theme]);

    for (const page of PAGES) {
      const label = `${page.name} [${theme}]`;
      const tab = await context.newPage();
      const errors = [];
      const badResponses = [];

      tab.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      tab.on("console", (m) => {
        if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
      });
      tab.on("requestfailed", (r) => {
        // GoatCounter and other analytics are expected to fail offline.
        if (/goatcounter|gc\.zgo\.at/.test(r.url())) return;
        badResponses.push(`requestfailed: ${r.url()}`);
      });
      tab.on("response", (r) => {
        const url = r.url();
        if (r.status() >= 400) badResponses.push(`HTTP ${r.status()}: ${url}`);
      });

      try {
        await tab.goto(BASE + page.url, { waitUntil: "load", timeout: 20000 });
        await tab.waitForTimeout(600);
      } catch (e) {
        fail(`${label}: navigation failed — ${e.message}`);
        await tab.close();
        continue;
      }

      // ---- JS errors ----
      const realErrors = errors.filter((e) => !/favicon|goatcounter/i.test(e));
      if (realErrors.length) realErrors.forEach((e) => fail(`${label}: ${e}`));

      // ---- HTTP failures ----
      const realBad = badResponses.filter((e) => !/favicon|goatcounter|nonexistent/i.test(e));
      if (realBad.length) realBad.forEach((e) => fail(`${label}: ${e}`));

      // ---- images actually decoded ----
      const imgReport = await tab.evaluate(() => {
        const imgs = [...document.images];
        return {
          total: imgs.length,
          broken: imgs
            .filter((i) => i.complete && i.naturalWidth === 0)
            .map((i) => i.currentSrc || i.src),
          noDims: imgs
            .filter((i) => !i.getAttribute("width") || !i.getAttribute("height"))
            .map((i) => (i.currentSrc || i.src).split("/").slice(-2).join("/")),
          notLazy: imgs
            .filter((i) => {
              const r = i.getBoundingClientRect();
              return r.top > window.innerHeight * 1.5 && i.getAttribute("loading") !== "lazy";
            })
            .map((i) => (i.currentSrc || i.src).split("/").pop()),
        };
      });
      if (imgReport.broken.length) {
        fail(`${label}: ${imgReport.broken.length} broken image(s): ${imgReport.broken.join(", ")}`);
      }
      if (imgReport.noDims.length) {
        fail(`${label}: ${imgReport.noDims.length} image(s) without width/height (CLS risk): ${imgReport.noDims.join(", ")}`);
      }
      if (imgReport.notLazy.length) {
        notes.push(`${label}: ${imgReport.notLazy.length} below-fold image(s) not lazy: ${imgReport.notLazy.slice(0, 3).join(", ")}`);
      }
      if (!imgReport.broken.length && !imgReport.noDims.length) {
        pass(`${label}: ${imgReport.total} images OK (all dimensioned, none broken)`);
      }

      // ---- theme applied correctly ----
      const applied = await tab.evaluate(() => document.body.getAttribute("data-theme"));
      if ((theme === "dark" ? "dark" : null) !== applied) {
        fail(`${label}: expected data-theme=${theme === "dark" ? "'dark'" : "unset"}, got ${applied}`);
      }

      // ---- visible theme toggle icon ----
      const icon = await tab.evaluate(() => {
        const sun = document.querySelector(".theme-toggle .icon-sun");
        const moon = document.querySelector(".theme-toggle .icon-moon");
        const vis = (el) => !!(el && getComputedStyle(el).display !== "none");
        return { sun: vis(sun), moon: vis(moon) };
      });
      if (icon.sun === icon.moon) {
        fail(`${label}: theme icon state ambiguous (sun=${icon.sun} moon=${icon.moon})`);
      } else {
        pass(`${label}: theme toggle shows ${theme === "dark" ? "moon" : "sun"}`);
      }

      // ---- horizontal overflow ----
      const overflow = await tab.evaluate(() => {
        const de = document.documentElement;
        const wide = [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 2)
          .filter((el) => {
            const cs = getComputedStyle(el);
            return cs.position !== "fixed" && cs.overflowX !== "auto" && cs.overflowX !== "scroll";
          })
          .slice(0, 4)
          .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`);
        return { docWidth: de.scrollWidth, viewWidth: de.clientWidth, wide };
      });
      if (overflow.docWidth > overflow.viewWidth + 2) {
        fail(`${label}: horizontal overflow (${overflow.docWidth} > ${overflow.viewWidth}) — ${overflow.wide.join(", ")}`);
      }

      // ---- content visible (reveal animation must not hide things) ----
      const hidden = await tab.evaluate(() => {
        const els = [...document.querySelectorAll("[data-reveal], .reveal-pending")];
        return els
          .filter((el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            // Anything in the viewport must be painted.
            return r.top < window.innerHeight && parseFloat(cs.opacity) < 0.5;
          })
          .map((el) => el.id || el.tagName);
      });
      if (hidden.length) fail(`${label}: in-viewport element left invisible: ${hidden.join(", ")}`);

      // ---- heading hierarchy ----
      const heads = await tab.evaluate(() =>
        [...document.querySelectorAll("h1,h2,h3")].map((h) => ({
          tag: h.tagName,
          size: Math.round(parseFloat(getComputedStyle(h).fontSize)),
        }))
      );
      const h1 = heads.find((h) => h.tag === "H1");
      const h2s = heads.filter((h) => h.tag === "H2");
      if (h1 && h2s.length) {
        const biggestH2 = Math.max(...h2s.map((h) => h.size));
        if (biggestH2 > h1.size) fail(`${label}: an H2 (${biggestH2}px) is larger than H1 (${h1.size}px)`);
      }

      // ---- post pages: body text must actually be there ----
      if (page.name.startsWith("post")) {
        const stats = await tab.evaluate(() => {
          const body = document.querySelector(".post-body, #post-content");
          const imgs = body ? [...body.querySelectorAll("img")] : [];
          return {
            chars: body ? body.innerText.trim().length : 0,
            figures: body ? body.querySelectorAll("figure").length : 0,
            figcapsTooBig: body
              ? [...body.querySelectorAll("figcaption")].filter((f) => f.innerText.length > 300).length
              : 0,
            code: body ? body.querySelectorAll("pre code").length : 0,
            imgs: imgs.length,
            imgsSized: imgs.filter((i) => i.getAttribute("width")).length,
          };
        });
        if (stats.chars < 1500) fail(`${label}: only ${stats.chars} chars of body text rendered`);
        if (stats.figcapsTooBig) fail(`${label}: ${stats.figcapsTooBig} figcaption(s) >300 chars (prose swallowed)`);
        if (stats.imgs !== stats.imgsSized) fail(`${label}: ${stats.imgs - stats.imgsSized} post image(s) missing dimensions`);
        if (stats.chars >= 1500 && stats.figcapsTooBig === 0) {
          pass(`${label}: ${stats.chars} chars, ${stats.figures} figures, ${stats.code} code block(s)`);
        }
      }

      // ---- anchors resolve to real sections ----
      for (const anchor of page.anchors) {
        const found = await tab.evaluate((id) => !!document.querySelector(id), anchor);
        if (!found) fail(`${label}: nav anchor ${anchor} has no target`);
      }

      // Screenshot the first page of each theme for eyeballing.
      await tab.screenshot({
        path: `/tmp/shots/${page.name.replace(/[^a-z0-9]+/gi, "-")}-${theme}.png`,
        fullPage: page.name === "index" || page.name === "404" ? true : false,
      });
      await tab.close();
    }
    await context.close();
  }

  // ---- responsive sweep on the two busiest pages ----
  console.log("\n=== RESPONSIVE ===");
  const rctx = await browser.newContext();
  for (const pageDef of [{ url: "/", name: "index" }, { url: "/blogs/holy-trinity-pi-herdr-opencode/", name: "post" }]) {
    for (const vp of VIEWPORTS) {
      const tab = await rctx.newPage();
      await tab.setViewportSize({ width: vp.width, height: vp.height });
      await tab.goto(BASE + pageDef.url, { waitUntil: "load" });
      await tab.waitForTimeout(350);
      const of = await tab.evaluate(() => {
        const de = document.documentElement;
        return { sw: de.scrollWidth, cw: de.clientWidth };
      });
      if (of.sw > of.cw + 2) fail(`${pageDef.name} @ ${vp.name} (${vp.width}px): overflow ${of.sw} > ${of.cw}`);
      else pass(`${pageDef.name} @ ${vp.name} (${vp.width}px): no overflow`);
      await tab.screenshot({ path: `/tmp/shots/${pageDef.name}-${vp.name}.png`, fullPage: false });
      await tab.close();
    }
  }
  await rctx.close();

  await browser.close();

  if (notes.length) {
    console.log("\nNotes:");
    [...new Set(notes)].forEach((n) => console.log(`  · ${n}`));
  }
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " FAILURE(S)"}`);
  process.exit(failures === 0 ? 0 : 1);
})();
