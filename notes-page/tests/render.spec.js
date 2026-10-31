// notes-page render test: one Playwright render against the golden page JSON.
// Serves this directory over HTTP, fakes the Notes Service API, and asserts
// the seven PLAN cases. Run: npm --prefix notes-page test
// (needs the chromium headless shell: npx playwright install --only-shell chromium)
const { test, expect } = require("@playwright/test");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..");
// Real-layout path (notes-page/ at the repo root); golden JSON is the oracle.
const GOLDEN = JSON.parse(
  fs.readFileSync(path.join(DIR, "..", "contracts", "golden", "page.json"), "utf8"),
);
const MEETING_ID = GOLDEN.meeting.meeting_id;
const POINT_ID = GOLDEN.points[0].point_id;
const TURN_ID = GOLDEN.transcript_lines[0].turn_id;

function degradedPage() {
  const page = JSON.parse(JSON.stringify(GOLDEN));
  page.meeting.degraded = true;
  return page;
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

let server;
let baseURL;
const postedTags = [];

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type || "application/json" });
  res.end(body);
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/meetings") {
      return send(res, 200, JSON.stringify([
        { meeting_id: MEETING_ID, subject: GOLDEN.meeting.subject, people: ["Layla"], date: "Tue 28 Oct" },
      ]));
    }
    if (req.method === "GET" && url.pathname === "/api/meetings/" + MEETING_ID) {
      return send(res, 200, JSON.stringify(GOLDEN));
    }
    if (req.method === "GET" && url.pathname === "/api/meetings/degraded") {
      return send(res, 200, JSON.stringify(degradedPage()));
    }
    if (req.method === "GET" && url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const hits = q && GOLDEN.points[0].text.toLowerCase().includes(q)
        ? [{
            meeting_id: MEETING_ID,
            subject: GOLDEN.meeting.subject,
            snippet: GOLDEN.points[0].text,
            line: TURN_ID,
            speaker: "Layla",
            scope: "point",
            kind: GOLDEN.points[0].kind,
          }]
        : [];
      return send(res, 200, JSON.stringify({ hits }));
    }
    if (req.method === "POST" && url.pathname === "/api/tags") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        postedTags.push(JSON.parse(raw));
        send(res, 200, "{}");
      });
      return;
    }
    const file = path.normalize(path.join(DIR, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
    if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("nope");
      return;
    }
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || "application/octet-stream");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = "http://127.0.0.1:" + server.address().port;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(async ({ page }) => {
  postedTags.length = 0;
});

test("(1) list view renders meetings and search hits with highlights", async ({ page }) => {
  await page.goto(baseURL + "/");
  await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible();
  await expect(page.locator(".mtg-card", { hasText: "Launch readiness" })).toBeVisible();
  await expect(page.locator("#q")).toBeVisible();
  await page.locator("#q").fill("launch");
  const hit = page.locator(".hit").first();
  await expect(hit).toBeVisible();
  await expect(hit.locator("mark")).toHaveText("Launch");
});

test("(2) meeting view: avatar selects person with why, points, actions, filter counts", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.getByRole("heading", { name: "Launch readiness" })).toBeVisible();
  await page.locator('.person[data-person="Layla"]').click();
  const panel = page.locator(".panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Owns RTL.");
  await expect(panel).toContainText("Launch moves to Nov 12");
  await expect(panel.locator(".ugroup")).toHaveCount(1);
  const decisionFilter = page.locator('[data-cat="decision"] em');
  await expect(decisionFilter).toHaveText("1");
  await expect(page.locator('[data-cat="all"] em').first()).toHaveText("1");
});

test("(3) action board groups Urgent/Medium/Later with assigned style", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.locator(".ucol.u-urgent h3")).toContainText("Urgent");
  await expect(page.locator(".ucol.u-medium")).toContainText("Launch moves to Nov 12");
  await expect(page.locator(".ucol.u-later .empty")).toBeVisible();
  const action = page.locator(".ucol.u-medium .act").first();
  await expect(action).toHaveClass(/asg/);
  await expect(action.locator(".badge.as")).toHaveText("Assigned");
});

test("(4) point click jumps to the transcript line and recording position", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await page.locator(".pt-main").first().click();
  const active = page.locator("#lines .ln.on");
  await expect(active).toBeVisible();
  await expect(active).toContainText("Launch moves to Nov 12.");
  await expect(page.locator(".recoff")).toContainText("recordings/golden.webm");
  await expect(page.locator("audio#rec")).toHaveAttribute(
    "src", "/api/audio?meeting_id=" + MEETING_ID);
});

test("(5) re-tag posts tags.set fields and re-renders as by you", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await page.locator(".col.c-decision details.retag summary").click();
  await page.locator('[data-retag="' + POINT_ID + '"][data-val="question"]').click();
  await expect.poll(() => postedTags.length, { timeout: 5000 }).toBe(1);
  expect(postedTags[0]).toEqual({ target: "point", target_id: POINT_ID, kind: "question" });
  await expect(page.locator("summary", { hasText: "by you" }).first()).toBeVisible();
  await expect(page.locator(".c-question .txt").first()).toContainText("Launch moves to Nov 12");
});

test("(6) degraded page shows the fallback banner with live points", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=degraded");
  await expect(page.locator(".degraded")).toContainText("AI summary failed");
  await expect(page.locator(".ucol.u-medium")).toContainText("Launch moves to Nov 12");
});

test("(7) Arabic toggle renders RTL with Arabic labels and no overflow at 560px", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await page.locator('[data-lang="ar"]').click();
  await expect(page.locator("html[dir='rtl']")).toBeAttached();
  await expect(page.locator("#crumb")).toContainText("الاجتماعات");
  await expect(page.locator(".ucol.u-medium h3").first()).toContainText("متوسط");
  const overflow = await page.evaluate(
    () => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
