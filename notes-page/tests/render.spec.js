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
          archived: home.archived, meeting_type: home.type, ...(home.typeBy ? { type_by: home.typeBy } : {}) },
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
    if (req.method === "POST" && ["/api/meetings/archive", "/api/meetings/type", "/api/folders/rename",
      "/api/folders/delete", "/api/folders/move"].includes(url.pathname)) {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw);
        home.posts.push({ path: url.pathname, body });
        if (url.pathname === "/api/meetings/archive") home.archived = body.archived;
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
  Object.assign(home, { archived: false, type: null, typeBy: null, urgent: 1, posts: [] });
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
  await page.locator("#preview .pv-open").click();
  await expect(title).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/notes/" + MEETING_ID);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Meetings" })).toBeVisible();
  await page.goForward();
  await expect(title).toBeVisible();
});

test("(9) clicking a meeting previews it: title, summary, plates, and a Simple / Detailed line", async ({ page }) => {
  await page.goto(baseURL + "/");
  await page.locator("#list .row").first().click();
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
  // Karim 2026-11-04: folders and Archived live in one dropdown, not the tab row.
  const tab = page.locator(".tabs .fmenu [data-tab^='f:']", { hasText: "Launch" });
  await expect(tab).toContainText("1");
  await page.locator(".tabs .fmenu summary").click();
  await tab.click();
  await expect(page.locator(".tabs .fmenu summary")).toContainText("Launch");
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
  await expect(finding).toContainText("1 action item for you");
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

// Karim 2026-11-04: not "Halo Notes" + "Meetings"; "Halo", then Meetings and Notes tabs.
test("(H7) the header says Halo with Meetings and Notes tabs", async ({ page }) => {
  await page.goto(baseURL + "/");
  await expect(page.locator(".logo")).toHaveText("Halo");
  const meetings = page.locator('#crumb [data-nav="list"]');
  const notes = page.locator("#crumb .nav-notes");
  await expect(meetings).toHaveAttribute("aria-current", "page");
  await page.locator("#preview .pv-open").click();
  await expect(notes).toHaveAttribute("aria-current", "page");
  await meetings.click();
  await expect(meetings).toHaveAttribute("aria-current", "page");
  await notes.click(); // back to the meeting last opened
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(GOLDEN.meeting.title);
});
