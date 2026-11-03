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

// Model text as it arrives live: no capital, no end mark, a title ending in ".".
function messyPage() {
  const page = JSON.parse(JSON.stringify(GOLDEN));
  page.meeting.title = "launch readiness review.";
  page.points[0].text = "launch  moves to nov 12";
  return page;
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

let server;
let baseURL;
const postedTags = [];
// Fake folder store, same shapes as the Notes Service /api/folders.
const folders = { list: [], byMeeting: {} };

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type || "application/json" });
  res.end(body);
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/meetings") {
      return send(res, 200, JSON.stringify([
        { meeting_id: MEETING_ID, subject: GOLDEN.meeting.subject, title: GOLDEN.meeting.title,
          people: ["Layla"], date: "Tue 28 Oct", folder_id: folders.byMeeting[MEETING_ID] || null },
      ]));
    }
    if (req.method === "GET" && url.pathname === "/api/meetings/" + MEETING_ID) {
      return send(res, 200, JSON.stringify(GOLDEN));
    }
    if (req.method === "GET" && url.pathname === "/api/meetings/messy") {
      return send(res, 200, JSON.stringify(messyPage()));
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
    if (url.pathname === "/api/folders") {
      if (req.method === "GET") {
        return send(res, 200, JSON.stringify(folders.list.map((f) => ({
          ...f, count: Object.values(folders.byMeeting).filter((id) => id === f.folder_id).length,
        }))));
      }
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw);
        const folder = { folder_id: "f" + (folders.list.length + 1), name: body.name };
        folders.list.push(folder);
        if (body.meeting_id) folders.byMeeting[body.meeting_id] = folder.folder_id;
        send(res, 201, JSON.stringify(folder));
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/ask") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const q = JSON.parse(raw).q;
        if (q === "fail") return send(res, 502, JSON.stringify({ error: "model_failed", answer: "x", citations: [] }));
        send(res, 200, JSON.stringify({
          answer: "Launch moves to Nov 12, said Layla.",
          citations: [{ meeting_id: MEETING_ID, subject: GOLDEN.meeting.subject, snippet: GOLDEN.points[0].text,
                        line: TURN_ID, speaker: "Layla", scope: "point", kindLabel: "decision" }],
        }));
      });
      return;
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
  folders.list.length = 0;
  for (const k of Object.keys(folders.byMeeting)) delete folders.byMeeting[k];
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
  await expect(page.getByRole("heading", { name: GOLDEN.meeting.title })).toBeVisible();
  await expect(page.locator(".mtg-summary")).toHaveText(GOLDEN.meeting.summary);
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

// Karim 2026-11-02: browser Back must work, a hovered meeting previews on
// the right (like Wispr Flow), meetings go into folders, and an assigned
// action can be emailed to its owner.
test("(8) browser Back and Forward move between the list and a meeting", async ({ page }) => {
  await page.goto(baseURL + "/");
  const title = page.getByRole("heading", { level: 1, name: GOLDEN.meeting.title });
  await expect(page.locator("#preview h2")).toBeVisible(); // the newest meeting is previewed first
  await page.locator(".mtg-card").first().click();
  await expect(title).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/notes/" + MEETING_ID);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Meetings" })).toBeVisible();
  await page.goForward();
  await expect(title).toBeVisible();
});

test("(9) hovering a meeting previews its title, summary and action counts", async ({ page }) => {
  await page.goto(baseURL + "/");
  await expect(page.locator(".mtg-card").first()).toContainText(GOLDEN.meeting.title);
  await page.locator(".mtg-card").first().hover();
  const preview = page.locator("#preview");
  await expect(preview).toContainText(GOLDEN.meeting.title);
  await expect(preview).toContainText(GOLDEN.meeting.summary);
  await expect(preview).toContainText(GOLDEN.actions[0].text);
  await expect(preview.locator(".pv-counts")).toContainText("Medium 1");
});

test("(10) create a folder from a meeting, then filter the list by it", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator(".mtg-card").first().hover();
  await page.locator("#preview .new-folder").fill("Launch");
  await page.locator("#preview .create-folder").click();
  const folder = page.locator(".folders [data-folder]", { hasText: "Launch" });
  await expect(folder).toContainText("1");
  await folder.click();
  await expect(page.locator(".mtg-card")).toHaveCount(1);
  await page.locator(".folders [data-folder='']").click();
  await expect(page.locator(".mtg-card")).toHaveCount(1);
});

test("(11) an assigned action has an email link carrying its text and the meeting", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator(".mtg-card").first().click();
  const mail = page.locator("a.mail").first();
  const href = decodeURIComponent(await mail.getAttribute("href"));
  expect(href.startsWith("mailto:?")).toBe(true);
  expect(href).toContain(GOLDEN.actions[0].text);
  expect(href).toContain(GOLDEN.meeting.title);
});

test("(12) shown text is tidy: capital first letter, end period, titles without one, Inter headers", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=messy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Launch readiness review");
  await expect(page.locator(".txt").first()).toHaveText("Launch moves to nov 12.");
  const h1Font = await page.locator("h1").first().evaluate((e) => getComputedStyle(e).fontFamily);
  expect(h1Font).toContain("Inter");
  expect(h1Font).not.toContain("Instrument Serif");
});

test("(13) disagreements: topic, each side's view, outcome and resolution", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  const board = page.locator(".dis");
  await expect(board.locator("h2")).toHaveText("Disagreements");
  const item = board.locator(".dis-item").first();
  await expect(item.locator("h3")).toHaveText("Beta launch date");
  await expect(item.locator(".dis-out")).toHaveText("Settled");
  await expect(item.locator(".dis-sides li")).toHaveText([
    "Layla Launch on November 12 if payments QA clears.",
    "Omar QA is not done; wait for December."]);
  await expect(item.locator(".dis-res")).toHaveText("Launch November 12; Omar signs off QA by Friday.");
});

test("(14) ask your meetings: the answer, its cited line opens the meeting, a failure says so", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#askq").fill("When is the launch?");
  await page.locator("#askq").press("Enter");
  await expect(page.locator(".answer .atext")).toHaveText("Launch moves to Nov 12, said Layla.");
  await expect(page.locator("#askq")).toHaveValue("When is the launch?");
  await page.locator(".answer .hit").first().click();
  await expect(page).toHaveURL(new RegExp("/notes/" + MEETING_ID));
  await page.goto(baseURL + "/");
  await page.locator("#askq").fill("fail");
  await page.locator(".ask .askbtn").click();
  await expect(page.locator(".answer .atext")).toHaveText("Halo could not answer. Try again.");
});
