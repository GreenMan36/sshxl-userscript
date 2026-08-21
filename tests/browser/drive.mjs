// Smoke-test driver: loads the built userscript into a real Chromium (Edge)
// tab, injected on every navigation like a userscript manager would, then
// drives a full run against fixtures built from real saved sshxl.nl markup.
//
// Prerequisite: node tests/browser/serve.cjs   (or: pnpm smoke)
// Run:          pnpm exec node tests/browser/drive.mjs
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8791";
const OVERVIEW = `${BASE}/nl/aanbod`;
const ROOMS = [
  { id: "9999001", url: `${BASE}/nl/aanbod/9999001-test-k1` },
  { id: "9999002", url: `${BASE}/nl/aanbod/9999002-applied-k2` },
  { id: "9999003", url: `${BASE}/nl/aanbod/9999003-applied-k3` },
  { id: "9999004", url: `${BASE}/nl/aanbod/9999004-refused-k4` },
];

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

try {
  const script = readFileSync(
    new URL("../../dist/sshxl-autoapply.user.js", import.meta.url),
    "utf8",
  );
  await page.evaluateOnNewDocument(script);

  // ---- 1. overview fixture: open hub + plan --------------------------------
  await page.goto(OVERVIEW, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear()); // deterministic start
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#sshxl-aa-pill", { timeout: 15000 });
  await page.evaluate(() => document.querySelector("#sshxl-aa-pill").click()); // hub starts closed
  await page.waitForSelector("#sshxl-aa-drawer", { timeout: 15000 });

  const plan = await page.evaluate(() => window.__sshxlAA.plan());
  check("hub opens on pill click (state persisted)", true);
  check("plan fills all free slots (7)", plan.picks.length === 7, `picked ${plan.picks.length}`);
  check(
    "picks are most urgent first (endsAtTs ascending)",
    plan.picks.every((p, i, a) => i === 0 || a[i - 1].endsAtTs <= p.endsAtTs),
    `first pick endsAt=${plan.picks[0]?.endsAtTs}`,
  );
  check(
    "parseRemainingHours",
    await page.evaluate(() => {
      const p = window.__sshxlAA.parseRemainingHours;
      return (
        p("Er kan nog 2 dagen en 10 uur gereageerd worden.") === 58 &&
        p("Er kan nog 10 uur gereageerd worden.") === 10 &&
        p("") === undefined
      );
    }),
  );

  // ---- 2. drive a run over room fixtures ------------------------------------
  await page.evaluate((rooms) => {
    const state = window.__sshxlAA.state();
    // Low quota so the continuous run (which refills when slots stay free)
    // finishes quickly instead of grinding through every overview card.
    state.quota = 2;
    state.run = {
      kind: "apply",
      startedTs: Date.now(),
      lastNavTs: Date.now(),
      idx: 0,
      queue: rooms.map((r) => ({ id: r.id, url: r.url, title: `Room ${r.id}` })),
    };
    localStorage.setItem("sshxl-autoapply-v2", JSON.stringify(state));
  }, ROOMS);

  await page.goto(ROOMS[0].url, { waitUntil: "load" });

  await page.waitForFunction(() => window.__sshxlAA.state().db.listings["9999001"] !== undefined, {
    timeout: 30000,
  });
  let st = await page.evaluate(() => window.__sshxlAA.state());
  check(
    "first room applied via Reageer+Bevestigen",
    st.db.listings["9999001"]?.status === "applied",
    st.db.listings["9999001"]?.status,
  );
  check("run advanced to item 2", st.run?.idx === 1, `idx=${st.run?.idx}`);

  await page.waitForFunction(() => !window.__sshxlAA.state().run, { timeout: 30000 });
  st = await page.evaluate(() => window.__sshxlAA.state());
  check(
    "second room recognized as already applied",
    st.db.listings["9999002"]?.status === "applied",
  );
  check(
    "refused room recorded not-eligible with reason",
    st.db.listings["9999004"]?.status === "not-eligible" &&
      /niet mogelijk/i.test(st.db.listings["9999004"]?.reason ?? ""),
    `${st.db.listings["9999004"]?.status}: ${st.db.listings["9999004"]?.reason}`,
  );

  // A finished run lands on the reacties page (the authority), so the
  // results are confirmed and visible there.
  await page.waitForFunction(() => location.pathname.startsWith("/nl/mijn-ssh/reacties"), {
    timeout: 15000,
  });
  check("run finishes by navigating to the reacties page", true);

  // ---- 2.5. room detail merge: exact deadline overrides the estimate --------
  await page.goto(`${BASE}/nl/aanbod/9999005-cambridgelaan-787-k3`, { waitUntil: "load" });
  await page.waitForFunction(
    () => window.__sshxlAA.state().db.listings["9999005"]?.deadlineIso === "21-08-2026 om 23:59",
    { timeout: 30000 },
  );
  st = await page.evaluate(() => window.__sshxlAA.state().db.listings["9999005"]);
  const expectedEnds = await page.evaluate(() => new Date(2026, 7, 21, 23, 59).getTime());
  check(
    "room page exact deadline captured",
    st?.deadlineIso === "21-08-2026 om 23:59" && st?.endsAtTs === expectedEnds,
    `deadlineIso=${st?.deadlineIso} endsAtTs=${st?.endsAtTs}`,
  );
  check(
    "room page reaction count + position",
    st?.reactionCount === 87 && st?.slotPosition === 8,
    `count=${st?.reactionCount} pos=${st?.slotPosition}`,
  );

  // ---- 3. persistence on fresh overview load --------------------------------
  await page.goto(OVERVIEW, { waitUntil: "load" });
  await page.waitForSelector("#sshxl-aa-drawer", { timeout: 15000 });
  st = await page.evaluate(() => window.__sshxlAA.state());
  check(
    "state persisted across navigations",
    Object.keys(st.db.listings).length >= 4,
    `${Object.keys(st.db.listings).length} records`,
  );

  // ---- 4. SPA regression: room -> overview via History API (no reload) ------
  await page.goto(ROOMS[0].url, { waitUntil: "load" });
  await page.waitForSelector("#sshxl-aa-hub", { timeout: 15000 });
  const hudGone = await page.evaluate(() => !window.__sshxlAA.state().run);
  check("hub pill present on room without active run", hudGone);
  await page.evaluate(() => {
    history.pushState(null, "", "/nl/aanbod");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForFunction(
    () => location.pathname === "/nl/aanbod" && Boolean(document.querySelector("#sshxl-aa-drawer")),
    { timeout: 15000 },
  );
  check("drawer reopens after SPA navigation to overview", true);

  // ---- 5. reacties authority reconciliation (real saved page) --------------
  await page.goto(`${BASE}/nl/mijn-ssh/reacties`, { waitUntil: "load" });
  // Wait until the async scrape + reconcile have absorbed EVERY open teaser
  // (the run's own reactions can satisfy a plain length check too early).
  await page.waitForFunction(
    () => {
      const state = window.__sshxlAA.state();
      const active = new Set(Object.keys(state.activeReactions));
      const open = Array.from(document.querySelectorAll("article[class*='teaser--reaction-open']"))
        .map(
          (el) =>
            (el.querySelector("a[href*='/reacties/']")?.getAttribute("href") ?? "").match(
              /(\d+)$/,
            )?.[1],
        )
        .filter(Boolean);
      return open.length > 0 && open.every((id) => active.has(id));
    },
    { timeout: 30000 },
  );
  // The hub is open (state persisted from step 1); switch to the Reactions tab.
  await page.evaluate(() =>
    Array.from(document.querySelectorAll("#sshxl-aa-drawer nav button"))
      .find((b) => b.textContent === "Reactions")
      ?.click(),
  );
  await page.waitForFunction(
    () => document.querySelector("#sshxl-aa-drawer")?.textContent?.includes("Withdraw selected"),
    { timeout: 15000 },
  );
  check("hub reactions tab shows withdraw UI after switching", true);
  const reac = await page.evaluate(() => {
    const state = window.__sshxlAA.state();
    const active = new Set(Object.keys(state.activeReactions));
    const teasers = Array.from(document.querySelectorAll("article[class*='teaser--reaction']")).map(
      (el) => ({
        cls: el.className,
        id: (
          el.querySelector("a[href*='/nl/mijn-ssh/reacties/']")?.getAttribute("href") ?? ""
        ).match(/(\d+)$/)?.[1],
      }),
    );
    const ids = (clsRe) =>
      teasers
        .filter((t) => clsRe.test(t.cls ?? ""))
        .map((t) => t.id)
        .filter(Boolean)
        .sort();
    const open = ids(/teaser--reaction-open/);
    const closed = ids(/teaser--reaction-closed/);
    return {
      openIds: open,
      closedIds: closed,
      activeIds: [...active].sort(),
      sample: open[0] ? state.db.listings[open[0]] : undefined,
    };
  });
  const openMatch =
    reac.openIds.length > 0 && reac.openIds.every((id) => reac.activeIds.includes(id));
  const closedExcluded =
    reac.closedIds.length > 0 && reac.closedIds.every((id) => !reac.activeIds.includes(id));
  check(
    "reacties: activeReactions matches open teasers exactly",
    openMatch && closedExcluded,
    `open=${reac.openIds.join(",")} active=${reac.activeIds.join(",")} closed=${reac.closedIds.join(",")}`,
  );
  check(
    "reacties: open slot recorded applied with position",
    reac.sample?.status === "applied" &&
      typeof reac.sample?.slotPosition === "number" &&
      typeof reac.sample?.slotTotal === "number",
    `id=${reac.openIds[0]} status=${reac.sample?.status} pos=${reac.sample?.slotPosition}/${reac.sample?.slotTotal}`,
  );

  // The reacties reactions are activeReactions members AND overview cards, so
  // the overview should badge them "Applied".
  await page.goto(OVERVIEW, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("[data-sshxl-badge]")).some(
        (b) => b.textContent === "Applied",
      ),
    { timeout: 15000 },
  );
  check("applied listings are badged on the overview", true);

  // ---- 6. profile scrape (real saved page) ----------------------------------
  await page.goto(`${BASE}/nl/mijn-ssh/mijn-profiel`, { waitUntil: "load" });
  // The hub is open (state persisted); switch to the Settings tab. It shows
  // "unknown" and must populate reactively once the async scrape lands.
  await page.evaluate(() =>
    Array.from(document.querySelectorAll("#sshxl-aa-drawer nav button"))
      .find((b) => b.textContent === "Settings")
      ?.click(),
  );
  await page.waitForFunction(
    () => document.querySelector("#sshxl-aa-drawer")?.textContent?.includes("born 1999"),
    { timeout: 30000 },
  );
  check("profile settings tab populates reactively after scrape", true);
  const prof = await page.evaluate(() => window.__sshxlAA.state().preferences);
  check(
    "profile scraped gender + well-formed birth/signup",
    typeof prof?.gender === "string" &&
      prof.gender.length > 0 &&
      typeof prof?.birthYear === "number" &&
      prof.birthYear >= 1950 &&
      prof.birthYear <= 2010 &&
      /^\d{4}-\d{2}-\d{2}$/.test(prof?.signUpDate ?? ""),
    `gender=${prof?.gender} birth=${prof?.birthYear} signup=${prof?.signUpDate}`,
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
