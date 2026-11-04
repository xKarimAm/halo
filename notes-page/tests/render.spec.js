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

function emptyPage() {
  const page = degradedPage();
  page.transcript_lines = [];
  page.points = [];
  page.actions = [];
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
const status = { meta_key: true };
const audio = { status: 404, hits: 0 };
const home = { archived: false, type: null, typeBy: null, urgent: 1, posts: [] };

function send(res, status, body, type) {
  res.writeHead(status, { "Content-Type": type || "application/json" });
  res.end(body);
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/audio") {
      audio.hits += 1;
      send(res, audio.status, JSON.stringify({ detail: "no recording yet" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      send(res, 200, JSON.stringify(status));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/meetings") {
      return send(res, 200, JSON.stringify([
        { meeting_id: MEETING_ID, subject: GOLDEN.meeting.subject, title: GOLDEN.meeting.title,
          people: ["Layla"], date: "Tue 28 Oct", folder_id: folders.byMeeting[MEETING_ID] || null,
          t0_ms: GOLDEN.meeting.t0_ms, self_name: "Layla", minutes: 1,
          counts: { decision: 1, question: 0, pushback: 0, urgent: home.urgent },
          archived: home.archived, meeting_type: home.type, ...(home.typeBy ? { type_by: home.typeBy } : {}),
          ...(home.deleted ? { deleted_at: "2026-11-04T20:00:00+00:00", purge_in_days: 30 } : {}) },
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
    if (req.method === "GET" && url.pathname === "/api/meetings/empty") {
      return send(res, 200, JSON.stringify(emptyPage()));
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
    if (req.method === "POST" && ["/api/meetings/archive", "/api/meetings/delete", "/api/meetings/type", "/api/folders/rename",
      "/api/folders/delete", "/api/folders/move"].includes(url.pathname)) {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw);
        home.posts.push({ path: url.pathname, body });
        if (url.pathname === "/api/meetings/archive") home.archived = body.archived;
        if (url.pathname === "/api/meetings/delete") home.deleted = body.deleted;
        if (url.pathname === "/api/meetings/type") { home.type = body.meeting_type; home.typeBy = body.meeting_type ? "you" : null; }
        if (url.pathname === "/api/folders/delete") {
          folders.list.splice(folders.list.findIndex((f) => f.folder_id === body.folder_id), 1);
          for (const k of Object.keys(folders.byMeeting)) if (folders.byMeeting[k] === body.folder_id) delete folders.byMeeting[k];
        }
        if (url.pathname === "/api/folders/rename") folders.list.find((f) => f.folder_id === body.folder_id).name = body.name;
        if (url.pathname === "/api/folders/move") {
          if (body.folder_id) folders.byMeeting[body.meeting_id] = body.folder_id; else delete folders.byMeeting[body.meeting_id];
        }
        send(res, 200, "{}");
      });
      return;
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
  status.meta_key = true;
  audio.status = 404;
  audio.hits = 0;
  Object.assign(home, { archived: false, deleted: false, type: null, typeBy: null, urgent: 1, posts: [] });
  folders.list.length = 0;
  for (const k of Object.keys(folders.byMeeting)) delete folders.byMeeting[k];
});

test("(1) list view renders meetings and search hits with highlights", async ({ page }) => {
  await page.goto(baseURL + "/");
  await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible();
  const row = page.locator("#list .row", { hasText: GOLDEN.meeting.title });
  await expect(row).toBeVisible();
  await expect(row.locator(".strip i.decision")).toHaveCount(1); // the call strip marks each point at its second
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
  audio.status = 206; // this meeting has a recording
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
  await page.locator(".col.c-decision li.pt").first().hover(); // hover-only control
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

test("(6c) fact checks show the verdict, the note and a real source link", async ({ page }) => {
  const checked = JSON.parse(JSON.stringify(GOLDEN));
  checked.fact_checks = [
    { point_id: POINT_ID, claim: "Qatar has 10 million people.", speaker_name: "Omar", verdict: "disputed",
      note: "It is about 3.1 million.", sources: ["https://www.a.example/qatar", "javascript:alert(1)"] },
    { point_id: POINT_ID, claim: "The Act began in 2024.", speaker_name: "Layla", verdict: "supported",
      note: "It entered into force in August 2024.", sources: ["https://b.example/act"] },
  ];
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(checked) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  const items = page.locator(".fact-item");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Disputed");
  await expect(items.first()).toContainText("It is about 3.1 million.");
  await expect(items.first().locator("a")).toHaveCount(1); // the javascript: source is not a link
  await expect(items.first().locator("a")).toHaveAttribute("href", "https://www.a.example/qatar");
  await expect(items.first().locator("a")).toHaveAttribute("rel", /noopener/);
  await expect(items.nth(1)).toContainText("Checks out");
});

test("(6d) Visual recap draws only on request, then shows the saved image", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/meetings/" + MEETING_ID + "/recap", (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") });
  });
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.locator(".recap img")).toHaveCount(0);
  expect(posts).toBe(0);
  await page.locator("#recapbtn").click();
  await expect(page.locator(".recap img")).toBeVisible();
  expect(posts).toBe(1);
});

test("(6e) a recap finishing after the viewer moved on never touches the other meeting", async ({ page }) => {
  const other = JSON.parse(JSON.stringify(GOLDEN));
  other.meeting.meeting_id = "00000099-0000-4000-8000-000000000099";
  other.meeting.title = "Another meeting";
  let finish;
  await page.route("**/api/meetings/" + MEETING_ID + "/recap", (route) => { finish = () => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  await page.route("**/api/meetings/" + other.meeting.meeting_id, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(other) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await page.locator("#recapbtn").click();
  await expect(page.locator("#recapbtn")).toBeDisabled();
  await page.evaluate((id) => window.__haloApp.openMeeting(id, false), other.meeting.meeting_id);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Another meeting");
  await expect(page.locator("#recapbtn")).toBeEnabled();
  finish();
  await page.waitForTimeout(150);
  await expect(page.locator(".recap img")).toHaveCount(0);
  await expect(page.locator("#recapbtn")).toBeEnabled();
});

test("(6f) a meeting still running shows no failure banner and no recap button", async ({ page }) => {
  const live = JSON.parse(JSON.stringify(GOLDEN));
  live.meeting.degraded = true;
  live.meeting.in_progress = true;
  live.transcript_lines = [];
  live.points = [];
  live.actions = [];
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(live) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".degraded")).toHaveCount(0);
  await expect(page.locator("#recapbtn")).toHaveCount(0);
});

test("(6b) a meeting with no speech says so, not that the AI failed (#102)", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=empty");
  await expect(page.locator(".degraded")).toContainText("No speech was captured");
  await expect(page.locator("#view")).not.toContainText("AI summary failed");
  await expect(page.locator(".cols")).toHaveCount(0);
  await expect(page.locator(".ucol")).toHaveCount(0);
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
  await page.locator("#preview .pv-open").click();
  await expect(title).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/notes/" + MEETING_ID);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Meetings" })).toBeVisible();
  await page.goForward();
  await expect(title).toBeVisible();
});

// Karim 2026-11-04: clicking a meeting takes him to a page of its own.
test("(9a) clicking a meeting opens its own page, and Back returns to the list", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#list .row").first().click();
  await expect(page.getByRole("heading", { level: 1, name: GOLDEN.meeting.title })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/notes/" + MEETING_ID);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Meetings" })).toBeVisible();
});

test("(9b) Archive and Open meeting sit on one line", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#preview .pv-open").waitFor();
  // One frame for both boxes: CI read them in two calls while the preview still slid in.
  const [archive, open] = await page.evaluate(() => ["#preview [data-archive]", "#preview .pv-open"]
    .map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { y: r.top, height: r.height }; }));
  expect(Math.abs(open.y - archive.y)).toBeLessThan(1); // it was 6 px off
  expect(Math.abs(open.height - archive.height)).toBeLessThan(1);
});

test("(9) resting on a meeting previews it: title, summary, plates, and a Simple / Detailed line", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#list .row").first().hover();
  const preview = page.locator("#preview");
  await expect(preview.locator("h2")).toHaveText(GOLDEN.meeting.title);
  await expect(preview.locator(".p-sum")).toContainText(GOLDEN.meeting.summary);
  await expect(preview.locator(".p-act li")).toContainText(GOLDEN.actions[0].text);
  await expect(preview.locator(".big.simple .strip i.decision")).toHaveCount(1);
  await preview.locator("[data-view=detailed]").click();
  await expect(preview.locator(".big.detailed .lab", { hasText: "Layla" })).toBeVisible();
  // A plate item knows its mark: clicking it pins the mark and the tip says what it is.
  await preview.locator(".p-decision li").first().click();
  await expect(preview.locator(".big .strip i.on")).toHaveCount(1);
  await expect(preview.locator(".tip")).toContainText(GOLDEN.points[0].text);
});

test("(10) a folder: create it from a meeting, filter by it, rename it, delete it (the meeting stays)", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#preview .new-folder").fill("Launch");
  await page.locator("#preview .create-folder").click();
  // Karim 2026-11-04 22:25: projects sit in the main tab row; Archived and Deleted in the menu.
  const tab = page.locator(".tabs > [data-tab^='f:']", { hasText: "Launch" });
  await expect(tab).toContainText("1");
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#list .row")).toHaveCount(1);
  await page.locator("[data-fdo=rename]").click();
  await page.locator("#frename").fill("Q4 launch");
  await page.locator("[data-fdo=rename-save]").click();
  await expect(page.locator(".tabs [data-tab^='f:']")).toContainText("Q4 launch");
  await page.locator("[data-fdo=delete]").click();
  await page.locator("[data-fdo=delete-yes]").click();
  await expect(page.locator(".tabs [data-tab^='f:']")).toHaveCount(0);
  await expect(page.locator(".tabs [aria-selected=true]")).toContainText("All meetings");
  await expect(page.locator("#list .row")).toHaveCount(1);
});

test("(H1) Urgent is red and clickable: the row's urgent count opens the Urgent tab; none left reads All clear", async ({ page }) => {
  await page.goto(baseURL + "/");
  const urgentTab = page.locator(".tabs [data-tab=urgent]");
  await expect(urgentTab).toHaveClass(/has/);
  await expect(urgentTab).toContainText("1");
  await page.locator("#list .row .urg-link").first().click();
  await expect(urgentTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#list .row")).toHaveCount(1);
  home.urgent = 0;
  await page.goto(baseURL + "/");
  await urgentTab.click();
  await expect(page.locator(".allclear")).toHaveText("All clear. Nothing needs you right now.");
});

test("(H2) archive a meeting, then undo it", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#preview [data-archive]").click();
  await expect(page.locator("#list .row .arch-tag")).toHaveText("Archived");
  expect(home.posts.at(-1)).toEqual({ path: "/api/meetings/archive", body: { meeting_id: MEETING_ID, archived: true } });
  await expect(page.locator(".tabs .fmenu [data-tab=archived]")).toContainText("1");
  await page.locator("#toast .toast-undo").click();
  await expect(page.locator("#list .row .arch-tag")).toHaveCount(0);
  expect(home.posts.at(-1).body.archived).toBe(false);
});

test("(H3) Halo sorts meetings by type; the user can set their own", async ({ page }) => {
  home.type = "planning";
  home.typeBy = "halo";
  await page.goto(baseURL + "/");
  await expect(page.locator("#list .row .tchip")).toHaveText("Planning");
  await expect(page.locator(".types [data-mtype=planning]")).toContainText("1");
  await expect(page.locator("#preview .ptype")).toContainText("sorted by Halo");
  await page.locator("#preview .mtype-set").selectOption("sales");
  await expect(page.locator("#list .row .tchip")).toHaveText("Sales");
  await expect(page.locator("#preview .ptype")).toContainText("set by you");
  expect(home.posts.at(-1)).toEqual({ path: "/api/meetings/type", body: { meeting_id: MEETING_ID, meeting_type: "sales" } });
});

test("(H4) since your last visit: new meetings and your action items until Mark as seen", async ({ page }) => {
  await page.goto(baseURL + "/");
  const finding = page.locator("#finding");
  await expect(finding).toContainText("1 new meeting");
  await expect(finding).toContainText("1 action item in them for you");
  await expect(page.locator("#list .row .newdot")).toHaveCount(1);
  await page.locator("#seen").click();
  await expect(finding).toContainText("Nothing new since your last visit");
  await expect(page.locator("#list .row .newdot")).toHaveCount(0);
  await page.reload();
  await expect(finding).toContainText("Nothing new since your last visit");
  await page.locator("#unseen").click();
  await expect(finding).toContainText("1 new meeting");
});

test("(H5) follow a person: click a face, the list shows only their meetings", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#preview .pmeta [data-follow=Layla]").click();
  await expect(page.locator(".follow")).toContainText("Following Layla");
  await expect(page.locator(".follow")).toContainText("in 1 of 1 meetings");
  await page.keyboard.press("Escape");
  await expect(page.locator(".follow")).toHaveCount(0);
});

test("(11) an assigned action has an email link carrying its text and the meeting", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#preview .pv-open").click();
  const mail = page.locator("a.mail").first();
  const href = decodeURIComponent(await mail.getAttribute("href"));
  expect(href.startsWith("mailto:?")).toBe(true);
  expect(href).toContain(GOLDEN.actions[0].text);
  expect(href).toContain(GOLDEN.meeting.title);
});

// Karim 2026-11-04: Email had gone from action items and decisions. It was
// hidden until hover on the meeting page and never on the meetings home.
test("(11a) Email shows without hovering on every action, suggested ones too", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#preview .pv-open").click();
  const acts = page.locator("li.act");
  await expect(acts.first()).toBeVisible();
  await expect(page.locator("li.act a.mail")).toHaveCount(await acts.count());
  await page.mouse.move(0, 0);
  await expect(page.locator("li.act a.mail").first()).toHaveCSS("opacity", "1");
});

test("(11c) the meetings home emails action items and decisions from the preview", async ({ page }) => {
  await page.goto(baseURL + "/");
  const action = decodeURIComponent(await page.locator("#preview .p-act a.mail").first().getAttribute("href"));
  expect(action.startsWith("mailto:?")).toBe(true);
  expect(action).toContain(GOLDEN.meeting.title);
  const decision = decodeURIComponent(await page.locator("#preview .p-decision a.mail").first().getAttribute("href"));
  expect(decision).toContain(GOLDEN.points[0].text);
  expect(decision).toContain(GOLDEN.points[0].speaker_name);
});

test("(11d) a point's Email sits on the same line as its speaker", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#preview .pv-open").click();
  const point = page.locator("li.pt").first();
  const mail = await point.locator("a.mail").boundingBox();
  const who = await point.locator(".mini").boundingBox();
  expect(Math.abs(mail.y + mail.height / 2 - (who.y + who.height / 2))).toBeLessThan(4);
});

// Karim 2026-11-04: "click a name, see the statement, send it as an email
// or a notice" to the person it is about: every point can be emailed.
test("(11b) any point can be emailed with its words, who said it and the meeting", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#preview .pv-open").click();
  const point = GOLDEN.points[0];
  const mail = page.locator("li.pt a.mail").first();
  const href = decodeURIComponent(await mail.getAttribute("href"));
  expect(href.startsWith("mailto:?")).toBe(true);
  expect(href).toContain(point.text);
  expect(href).toContain(point.speaker_name);
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

test("(15) a half-typed question survives a language switch", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#askq").fill("ماذا قررنا");
  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page.locator("#askq")).toHaveValue("ماذا قررنا");
});

test("(16) a meeting with no recording hides the player and says so", async ({ page }) => {
  // The test server answers /api/audio with 404, like the backend before a recording exists.
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.locator(".norec")).toHaveText("No recording for this meeting. The notes and transcript are complete.");
  await expect(page.locator(".player .prow")).toBeHidden();
  await expect(page.locator("audio#rec")).toBeHidden();
  await expect(page.getByText(/auto-deletes/)).toHaveCount(0);
});

test("(17) no Meta key: a banner says how to fix it, in both languages; with a key, none", async ({ page }) => {
  await page.goto(baseURL + "/");
  await expect(page.locator("#keybar")).toBeHidden();
  status.meta_key = false;
  await page.goto(baseURL + "/");
  await expect(page.locator("#keybar")).toHaveText(
    "Meta Model API key missing: put it after META_API_KEY= in .env and restart uv run halo. Until then there are no live transcripts, points, notes or answers.");
  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page.locator("#keybar")).toContainText("META_API_KEY");
  await expect(page.locator("#keybar")).toContainText("مفتاح");
});

test("(18) the recording is checked once per meeting; a live meeting says it comes at the end", async ({ page }) => {
  audio.status = 429; // the backend's answer while the meeting is still open
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.locator(".norec")).toHaveText("The recording is ready when the meeting ends.");
  await page.locator(".pt-main").first().click(); // re-renders the transcript panel
  await expect(page.locator(".norec")).toBeVisible();
  expect(audio.hits).toBe(1);
});


test("(H6) a disagreement tints its stretch of the line and the key names it", async ({ page }) => {
  const withOmar = JSON.parse(JSON.stringify(GOLDEN));
  withOmar.transcript_lines.push({ turn_id: "00000031-0000-4000-8000-000000000031", speaker_name: "Omar",
    text: "QA is not done.", ts_start_ms: GOLDEN.transcript_lines[0].ts_start_ms + 3000,
    ts_end_ms: GOLDEN.transcript_lines[0].ts_start_ms + 5000, recording_offset_ms: 4000 });
  withOmar.points.push({ ...GOLDEN.points[0], point_id: "00000041-0000-4000-8000-000000000041", speaker_name: "Omar",
    kind: "pushback", text: "QA is not done", is_action: false, turn_ids: ["00000031-0000-4000-8000-000000000031"] });
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(withOmar) }));
  await page.goto(baseURL + "/");
  // Karim 2026-11-04: no arcs; the stretch of the bar is tinted, and the key names it.
  await expect(page.locator("#preview .big .arc")).toHaveCount(0);
  const seg = page.locator("#preview .big .dis-seg");
  await expect(seg).toHaveCount(1);
  await expect(seg).toHaveClass(/o-settled/);
  await expect(page.locator("#preview .key .k-dis")).toHaveCount(1);
  await seg.dispatchEvent("mouseenter");
  await expect(page.locator("#preview .tip")).toContainText("Beta launch date");
});

// Karim 2026-11-04: "Notes" is just the focused view of a meeting, so there is
// no Notes tab: the header reads Meetings, then the open meeting's title.
test("(H7) the header says Halo, Meetings, then the open meeting; no Notes tab", async ({ page }) => {
  await page.goto(baseURL + "/");
  await expect(page.locator(".logo")).toHaveText("Halo");
  const meetings = page.locator('#crumb [data-nav="list"]');
  await expect(meetings).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#crumb .nav-notes")).toHaveCount(0);
  await expect(page.locator("#preview .pv-open")).toHaveText("Open meeting");
  await page.locator("#preview .pv-open").click();
  await expect(page.locator("#crumb .nav-title")).toHaveText(GOLDEN.meeting.title);
  await expect(page.locator("#crumb .nav-title")).toHaveAttribute("aria-current", "page");
  await meetings.click();
  await expect(meetings).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#crumb .nav-title")).toHaveCount(0);
});

// Karim 2026-11-04 approved the meeting-page draft: title on the ground, one
// follow-up email, actions as one list, decisions beside questions, fact checks
// grouped by claim, alerts apart from tips, your speaking last, one player.
function richPage() {
  const p = JSON.parse(JSON.stringify(GOLDEN));
  const pt = (n, kind, text) => ({ ...GOLDEN.points[0], point_id: `00000040-0000-4000-8000-0000000000${n}`, kind, text,
    quote: text, is_action: false, urgency: "later" });
  p.points.push(pt(41, "question", "When does the gateway go live?"), pt(42, "pushback", "March is too risky."),
    pt(43, "point", "Qatar has about 10 million people."));
  p.actions.push({ action_id: "00000050-0000-4000-8000-000000000051", text: "Finish the demo build.", owner: "Layla",
    status: "assigned", urgency: "urgent", point_id: GOLDEN.points[0].point_id });
  const fc = (claim) => ({ point_id: GOLDEN.points[0].point_id, claim, speaker_name: "Layla", verdict: "disputed",
    note: "It is about 3.2 million.", sources: ["https://a.example/q"] });
  p.fact_checks = [fc("Qatar has about 10 million people."), fc("Qatar has around 10 million people."),
    fc("Qatar has about 10 million people."), { ...fc("The EU AI Act entered into force in 2024."), verdict: "supported", note: "1 August 2024." }];
  p.coaching = [{ text: "Ask Layla for the date.", alert: false, at_ms: 1000 },
    { text: "Take a breath; your tone is rising.", alert: true, at_ms: 2000 }]
    .concat([1, 2, 3, 4, 5, 6].map((i) => ({ text: "Tip number " + i + ".", alert: false, at_ms: 3000 + i })));
  return p;
}

test("(M1) the meeting page follows the approved draft", async ({ page }) => {
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(richPage()) }));
  await page.route("**/api/meetings/" + MEETING_ID + "/speaking", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ speakers: 2, talk_share: 60, fair_share: 50, longest_ms: 39000, longest_at_ms: 1000, questions: 2, follow_ups: 0,
      cut_ins: [], pace_wpm: 140, hedged: [], try_next: { key: "ask" } }) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  // the title sits on the page ground, not in a box (Karim 23:41: never a band behind it)
  expect(await page.locator(".head").evaluate((n) => getComputedStyle(n).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  // one email drafts every action and decision
  const follow = page.locator("a.follow-up");
  await expect(follow).toHaveText("Email follow-up");
  const href = decodeURIComponent(await follow.getAttribute("href"));
  expect(href).toContain("Finish the demo build.");
  expect(href).toContain("Launch moves to Nov 12");
  // action items: one list, urgency groups stacked, urgent first
  const groups = page.locator(".ucol");
  const xs = await groups.evaluateAll((ns) => ns.map((n) => Math.round(n.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
  await expect(groups.first()).toHaveClass(/u-urgent/);
  // decisions beside open questions, above the disagreements
  const dec = await page.locator(".col.c-decision").boundingBox();
  const q = await page.locator(".col.c-question").boundingBox();
  expect(Math.abs(dec.y - q.y)).toBeLessThan(2);
  expect(dec.x).not.toBe(q.x);
  expect(dec.y).toBeLessThan((await page.locator(".board.dis").boundingBox()).y);
  // fact checks grouped by claim
  await expect(page.locator(".fact-item")).toHaveCount(2);
  await expect(page.locator(".fact-item").first()).toContainText("Checked 3 times");
  // coaching: alerts first, then tips, the rest folded
  await expect(page.locator(".board.coach h3").first()).toContainText("Alerts");
  await expect(page.locator(".board.coach .coach-item.c-alert")).toHaveCount(1);
  await expect(page.locator(".board.coach details summary")).toHaveText("+ 2 more");
  // your speaking is the last block
  await expect(page.locator("#stage > :last-child")).toHaveClass(/speaking/);
});

test("(M2) with a recording, the rail has one player, not two", async ({ page }) => {
  await page.route("**/api/audio?**", (route) => route.fulfill({ status: 206, contentType: "audio/webm", body: Buffer.from([0]) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.locator("audio#rec")).toBeVisible();
  await expect(page.locator(".player .prow")).toBeHidden();
});

test("(M3) Meetings uses the meeting page's background", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#view.home").waitFor();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(233, 228, 218)");
});

// Karim 2026-11-04: Archive and Open notes sat on different lines at 1024-1100 px and on phones.
test("(H8) Archive and Open meeting stay side by side at every width", async ({ page }) => {
  for (const width of [1440, 1100, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(baseURL + "/");
    await page.locator("#preview .pv-open").waitFor();
    const [arch, open] = await page.evaluate(() => ["#preview [data-archive]", "#preview .pv-open"]
      .map((s) => ({ y: document.querySelector(s).getBoundingClientRect().top })));
    expect(Math.abs(arch.y - open.y), `at ${width}px`).toBeLessThan(2);
  }
});

// Review 2026-11-04: Enter on a plate's Email was swallowed by the item's own
// key handler (the recording jumped instead), and a click also jumped it.
test("(H9) a plate's Email link is its own control: Enter and click do not jump the recording", async ({ page }) => {
  await page.goto(baseURL + "/");
  const mail = page.locator("#preview .p-act li a").first();
  await expect(mail).toHaveAttribute("href", /^mailto:/);
  const handled = await mail.evaluate((a) => {
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(handled).toBe(false);
  await expect(page.locator("#preview .flag")).toHaveCount(0);
  await mail.evaluate((a) => { a.addEventListener("click", (e) => e.preventDefault()); a.click(); });
  await expect(page.locator("#preview .flag")).toHaveCount(0);
});

// Karim 2026-11-04: the home felt sluggish. Measured: every row waited 55 ms
// more than the one above and its line 70 ms more, so the 19th row's line
// finished about 3 s after load. The stagger stops after the first rows.
test("(H10) the list's entrance stagger is capped", async ({ page }) => {
  await page.goto(baseURL + "/");
  const delays = await page.evaluate(() => {
    const ms = (v) => Math.max(...v.split(",").map((x) => parseFloat(x) * (x.includes("ms") ? 1 : 1000)));
    const row = document.createElement("button");
    row.className = "row";
    row.style.cssText = "--i:30;--d:34";
    const strip = document.createElement("div");
    strip.className = "strip";
    row.appendChild(strip);
    document.querySelector("#view.home #list, #view.home").appendChild(row);
    return [ms(getComputedStyle(row).animationDelay), ms(getComputedStyle(strip, "::before").animationDelay)];
  });
  expect(delays[0]).toBeLessThanOrEqual(400);
  expect(delays[1]).toBeLessThanOrEqual(600);
});

test("(H11) the Simple/Detailed pill: a slim pill whose knob sits inside it", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#view.home .vseg").waitFor();
  await page.locator('#view.home .vseg [data-view="detailed"]').click();
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const seg = document.querySelector("#view.home .vseg").getBoundingClientRect();
    const k = document.querySelector("#view.home .vknob");
    const kb = k.getBoundingClientRect();
    return { segH: seg.height, segR: seg.right, kR: kb.right, kL: kb.left, segL: seg.left, t: getComputedStyle(k).transform };
  });
  expect(m.segH).toBeLessThanOrEqual(30);
  expect(m.kR).toBeLessThanOrEqual(m.segR - 2);
  expect(m.kL).toBeGreaterThanOrEqual(m.segL + 2);
  expect(m.t).toMatch(/^matrix\(1, 0, 0, 1,/); // moved, never stretched
});

test("(H12) Coaching tips: everything the coach said, on the preview and the meeting page", async ({ page }) => {
  const coached = JSON.parse(JSON.stringify(GOLDEN));
  coached.coaching = [
    { text: "Ask Omar for the date.", alert: false, at_ms: 60000 },
    { text: "Take a breath; your tone is rising.", alert: true, at_ms: 90000 },
    { text: "Park the pricing talk.", alert: false, at_ms: 90000 },
    { text: "Invite Layla in.", alert: false, at_ms: 120000 },
    { text: "Agree on an owner.", alert: false, at_ms: 150000 },
  ];
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(coached) }));
  await page.goto(baseURL + "/");
  const plate = page.locator("#view.home .plate.p-coach");
  await expect(plate.locator("h3")).toContainText("Coaching tips");
  await expect(plate.locator("li.c-alert")).toContainText("Take a breath");
  await expect(plate).toContainText("Agree on an owner."); // all of it, not the first three
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.locator(".board.coach .coach-item")).toHaveCount(5);
  await expect(page.locator(".board.coach .coach-item.c-alert")).toContainText("Take a breath");
});

test("(M4) hover-only controls take no room at rest, so rows keep one height", async ({ page }) => {
  const p = JSON.parse(JSON.stringify(GOLDEN));
  ["When does the gateway go live?", "Is it supposed to say this?", "Should we worry about that for the first release?"]
    .forEach((text, i) => p.points.push({ ...GOLDEN.points[0], point_id: `00000040-0000-4000-8000-00000000006${i}`, kind: "question", text, quote: text, is_action: false }));
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(p) }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  const hs = await page.locator(".col.c-question li.pt").evaluateAll((ns) => ns.map((n) => Math.round(n.getBoundingClientRect().height)));
  expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(2);
  const retag = page.locator(".col.c-question li.pt").first().locator(".retag summary");
  await page.locator(".col.c-question li.pt").first().hover();
  await expect(retag).toBeVisible();
});

// Karim 2026-11-04: Arabic paragraphs on the meeting page were set left to right.
test("(M5) an Arabic summary, transcript line and disagreement read right to left in the English UI", async ({ page }) => {
  const p = JSON.parse(JSON.stringify(GOLDEN));
  p.meeting.summary = "اتفق الفريق على نشر النسخة الأولى في مارس مع تقليل الميزات، ويراجع Omar خطة التسويق.";
  p.transcript_lines[0].text = "خلينا نراجع ال roadmap قبل الاجتماع الجاي";
  p.meeting.disagreements = [{ topic: "موعد الإطلاق", outcome: "open", sides: [{ name: "Layla", view: "تفضل الإطلاق في أبريل." }], resolution: "" }];
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(p) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  const firstWordAtRight = (sel) => page.locator(sel).first().evaluate((n) => {
    const walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    let t = walk.nextNode();
    while (t && !/[\u0600-\u06FF]/.test(t.data)) t = walk.nextNode();
    const r = document.createRange();
    const i = t.data.search(/[\u0600-\u06FF]/);
    r.setStart(t, i); r.setEnd(t, i + 3);
    return n.getBoundingClientRect().right - r.getBoundingClientRect().right;
  });
  expect(await firstWordAtRight(".mtg-summary")).toBeLessThan(4);
  expect(await firstWordAtRight(".ln .o")).toBeLessThan(4);
  expect(await page.locator(".dis-sides li").first().getAttribute("dir")).toBe("rtl");
});

// Karim 2026-11-04: add last meeting's Markdown; the fact check uses it live.
test("(M6) a Markdown file becomes the meeting's reference notes, and a check can cite it", async ({ page }) => {
  let ref = { name: null, chars: 0 };
  const posted = [];
  await page.route("**/api/meetings/" + MEETING_ID + "/reference", (route) => {
    const m = route.request().method();
    if (m === "POST") { const b = route.request().postDataJSON(); posted.push(b); ref = { name: b.name, chars: b.text.length }; }
    if (m === "DELETE") ref = { name: null, chars: 0 };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ref) });
  });
  const checked = JSON.parse(JSON.stringify(GOLDEN));
  checked.fact_checks = [{ point_id: POINT_ID, claim: "We launch on 20 November.", speaker_name: "Layla", verdict: "disputed",
    note: "Your notes say 12 November.", sources: [], notes_quote: "We agreed to launch on 12 November." }];
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(checked) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.locator(".fact-item .notes-quote")).toContainText("We agreed to launch on 12 November.");
  await page.locator("#refFile").setInputFiles({ name: "last-week.md", mimeType: "text/markdown", buffer: Buffer.from("# Launch\n\n- We agreed to launch on 12 November.\n") });
  await expect(page.locator(".refrow")).toContainText("last-week.md");
  expect(posted[0]).toEqual({ name: "last-week.md", text: "# Launch\n\n- We agreed to launch on 12 November.\n" });
  await page.locator(".refrow [data-ref-clear]").click();
  await expect(page.locator(".refrow")).not.toContainText("last-week.md");
  await expect(page.locator("#refFile")).toHaveCount(1);
});

// Karim 2026-11-04: an Arabic line sits against the transcript's right wall, avatar and
// time with it; the transcript can be widened and narrowed; sections fold.
test("(M7) an Arabic transcript line is laid out right to left, against the right wall", async ({ page }) => {
  const p = JSON.parse(JSON.stringify(GOLDEN));
  p.transcript_lines[0].text = "خلينا نراجع ال roadmap قبل الاجتماع الجاي";
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(p) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  const ln = page.locator(".ln").first();
  await expect(ln).toHaveAttribute("dir", "rtl");
  const gap = await ln.evaluate((n) => {
    const lines = document.querySelector("#lines");
    return lines.getBoundingClientRect().left + lines.clientWidth - n.querySelector(".av").getBoundingClientRect().right;
  });
  expect(gap).toBeLessThan(20);
});

test("(M8) the transcript collapses to its header (shorter, same width), and remembers it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  const open = await page.locator("#tx").boundingBox();
  await expect(page.locator("#txFold")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#txFold").click();
  await expect(page.locator("#txFold")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#lines")).toHaveCount(0);
  const shut = await page.locator("#tx").boundingBox();
  expect(shut.height).toBeLessThan(open.height);
  expect(Math.round(shut.width)).toBe(Math.round(open.width));
  await page.reload();
  await expect(page.locator("#txFold")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#txFold").click();
  await expect(page.locator("#lines .ln").first()).toBeVisible();
});

test("(M9) a section folds to its heading and opens again", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  const fold = page.locator('.col.c-decision [data-fold]');
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".col.c-decision li").first()).toBeVisible();
  await fold.click();
  await expect(page.locator('.col.c-decision [data-fold]')).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".col.c-decision li")).toHaveCount(0);
  await page.locator('.col.c-decision [data-fold]').click();
  await expect(page.locator(".col.c-decision li").first()).toBeVisible();
  await expect(page.locator(".board [data-fold]").first()).toBeVisible(); // Action items fold too
});

// Karim 2026-11-04 22:25: an Arabic summary sits right, next to the transcript wall.
test("(M10) an Arabic summary's box sits on the right edge of the meeting header", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const p = JSON.parse(JSON.stringify(GOLDEN));
  p.meeting.summary = "اتفق الفريق على نشر النسخة الأولى في مارس مع تقليل الميزات، ويراجع Omar خطة التسويق قبل نهاية الأسبوع القادم مع فريق التصميم والمبيعات.";
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(p) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  const gap = await page.locator(".mtg-summary").evaluate((n) => n.parentElement.getBoundingClientRect().right - parseFloat(getComputedStyle(n.parentElement).paddingRight) - n.getBoundingClientRect().right);
  expect(gap).toBeLessThan(4);
  expect(await page.locator(".mtg-summary").getAttribute("dir")).toBe("rtl");
});

// Karim 2026-11-04 22:25: room to breathe above the folder row.
test("(M11) the preview's folder row sits clear of the summary cards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL + "/");
  await page.locator(".pfoot").first().waitFor();
  const gap = await page.locator(".pfoot").first().evaluate((n) => n.getBoundingClientRect().top - n.previousElementSibling.getBoundingClientRect().bottom);
  expect(gap).toBeGreaterThanOrEqual(16);
});

// Karim 2026-11-04 22:26: Arabic is always aligned to the right, everywhere in the app.
test("(M12) every Arabic text block on the meeting page reads right to left on the right", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const p = JSON.parse(JSON.stringify(GOLDEN));
  const ar = "خلينا نراجع خطة الإطلاق قبل الاجتماع الجاي";
  p.meeting.summary = ar;
  p.transcript_lines.forEach((l) => { l.text = ar; });
  p.points.forEach((x) => { x.text = ar; });
  p.actions.forEach((a) => { a.text = ar; });
  p.meeting.disagreements = [{ topic: "موعد الإطلاق", outcome: "open", sides: [{ name: "Layla", view: "تفضل الإطلاق في أبريل." }], resolution: "" }];
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(p) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await page.locator(".dis-item").first().waitFor();
  const wrong = await page.evaluate(() => {
    const AR = /^[^A-Za-z\u0590-\u08FF]*[\u0590-\u08FF]/;
    const out = [];
    for (const n of document.querySelectorAll("#view *")) {
      const cs = getComputedStyle(n);
      if (cs.display === "inline" || cs.display === "none" || !n.textContent.trim()) continue;
      if ([...n.children].some((c) => getComputedStyle(c).display !== "inline")) continue;
      if (!AR.test(n.textContent.trim())) continue;
      if (cs.direction !== "rtl" || !["right", "start"].includes(cs.textAlign)) out.push(n.tagName + "." + n.className + " " + cs.direction + " " + cs.textAlign);
    }
    for (const n of document.querySelectorAll('#view [dir="rtl"]')) {
      if (getComputedStyle(n).textAlign === "left") out.push(n.tagName + "." + n.className + " rtl but left");
    }
    return out;
  });
  expect(wrong).toEqual([]);
  // the disagreement's topic sits on the right of its row, not at the left
  const topicGap = await page.locator(".dis-head h3").first().evaluate((h) => h.parentElement.getBoundingClientRect().right - h.getBoundingClientRect().right);
  expect(topicGap).toBeLessThan(140); // only the "Still open" chip is to its right
});

// Karim 2026-11-04 22:25: an action can be marked done (with what was done) and undone.
test("(M13) Done moves an action to a Done column with its note; Undo brings it back", async ({ page }) => {
  const posts = [];
  await page.route("**/api/actions/done", (route) => {
    posts.push(JSON.parse(route.request().postData()));
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  const first = page.locator(".act [data-done]").first();
  await first.click();
  await page.locator("#doneNote").fill("Sent the new date to the team");
  await page.locator("#doneNote").press("Enter");
  await expect(page.locator(".ucol.u-done .act.done")).toHaveCount(1);
  await expect(page.locator(".act.done .doneline")).toContainText("Sent the new date to the team");
  expect(posts[0]).toMatchObject({ done: true, note: "Sent the new date to the team" });
  await page.locator(".act.done [data-undone]").click();
  await expect(page.locator(".act.done")).toHaveCount(0);
  expect(posts[1]).toMatchObject({ done: false });
});

// Karim 2026-11-04 22:25: Deleted keeps a meeting 30 days, out of every other tab; Restore brings it back.
test("(M14) Delete moves a meeting to Deleted (30 days); Restore brings it back", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#preview [data-delete]").click();
  await expect(page.locator("#list .row")).toHaveCount(0);
  await page.locator(".tabs .fmenu summary").click();
  await page.locator(".tabs .fmenu [data-tab=deleted]").click();
  await expect(page.locator("#list .row")).toHaveCount(1);
  await expect(page.locator("#list .row")).toContainText("removed in 30 days");
  await page.locator("#preview [data-delete]").click();
  await page.locator(".tabs [data-tab=all]").click();
  await expect(page.locator("#list .row")).toHaveCount(1);
});

// Karim 2026-11-04 22:25: notes added after the meeting are compared with it.
test("(M15) after the meeting, added notes are compared with it: what agrees, differs, follows up", async ({ page }) => {
  const compare = { summary: "The launch moved a week.", items: [
    { topic: "Launch date", here: "Launch moves to Nov 12", there: "Launch on 20 November", relation: "differs" },
    { topic: "Pricing page", here: "Omar owns it", there: "Omar owns it", relation: "agrees" }] };
  await page.route("**/api/meetings/" + MEETING_ID + "/reference", (route) => {
    const post = route.request().method() === "POST";
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(post ? { name: "last-week.md", chars: 20, compare } : { name: null, chars: 0 }) });
  });
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.locator(".refrow")).toContainText("Compare with another meeting's notes");
  await page.locator("#refFile").setInputFiles({ name: "last-week.md", mimeType: "text/markdown", buffer: Buffer.from("# Launch\n\n- Launch on 20 November.\n") });
  await expect(page.locator(".cmp .cmp-item")).toHaveCount(2);
  await expect(page.locator(".cmp h2")).toContainText("Compared with last-week.md");
  await expect(page.locator(".cmp .r-differs .cmp-rel")).toHaveText("Differs");
  await expect(page.locator(".refrow")).toContainText("compared with this meeting below");
});

// Karim 2026-11-04 22:34: an Induction button walks through every feature: what, why, how.
test("(M16) Induction tours the home, carries on into a meeting and ends on the models", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL + "/");
  await page.locator("#list .row").first().waitFor();
  await page.locator("#tourBtn").click();
  const card = page.locator(".tour-card");
  await expect(card.locator("h2")).toHaveText("Halo");
  await expect(card).toContainText("Why:");
  await page.keyboard.press("ArrowRight");
  await expect(card.locator("h2")).toHaveText("Search");
  await page.keyboard.press("Escape");
  await expect(page.locator("#tour")).toHaveCount(0);
  await page.locator("#tourBtn").click();
  for (let i = 0; i < 20 && !(await card.locator("[class*=pv-open]").textContent()).includes("Open a meeting"); i++) {
    await card.locator(".pv-open").click();
  }
  await card.locator(".pv-open").click(); // Open a meeting: the tour goes on there
  await expect(page.locator(".tour-card h2")).toHaveText("Title and summary");
  for (let i = 0; i < 25 && (await page.locator("#tour").count()); i++) {
    const title = await page.locator(".tour-card h2").textContent();
    if (title === "Built on Meta's models") break;
    await page.locator(".tour-card .pv-open").click();
  }
  await expect(page.locator(".tour-card h2")).toHaveText("Built on Meta's models");
  await expect(page.locator(".tour-card .pv-open")).toHaveText("Finish");
  await page.locator(".tour-card .pv-open").click();
  await expect(page.locator("#tour")).toHaveCount(0);
});

test("(M17) Arabic UI keeps English content left to right, dates and roles in Arabic", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const p = JSON.parse(JSON.stringify(GOLDEN));
  p.people.forEach((x) => { x.role = "Participant"; });
  await page.route("**/api/meetings/" + MEETING_ID, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(p) }));
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await page.locator('[data-lang="ar"]').click();
  await expect(page.locator("html[dir='rtl']")).toBeAttached();
  // an English point keeps its own direction, so its full stop stays at the end
  const dirs = await page.locator(".act .atext").evaluateAll((ns) => ns.map((n) => getComputedStyle(n).direction));
  expect(dirs.length).toBeGreaterThan(0);
  expect(dirs.every((d) => d === "ltr")).toBe(true);
  await expect(page.locator(".rl").first()).toHaveText("مشارك");
  await expect(page.locator("#view")).not.toContainText("Participant");
  const facts = await page.locator(".head .facts").textContent();
  expect(facts).toMatch(/[\u0600-\u06FF]/); // the weekday and month are Arabic
});
