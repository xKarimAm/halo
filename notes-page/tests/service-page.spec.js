// notes-page service-fixture render test: the page renders a REAL
// notes_service response, not the hand-written golden. The fixture
// (./fixtures/service-page.json) is TestClient output from the merged
// notes_service seed, validated against meeting-page.schema.json at
// generation time (.tmp/gen_service_fixture.py). Run: npm test
const { test, expect } = require("@playwright/test");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..");
// Real-layout path (notes-page/ at the repo root); TestClient output is the oracle.
const SERVICE = JSON.parse(
  fs.readFileSync(path.join(DIR, "tests", "fixtures", "service-page.json"), "utf8"),
);
const MEETING_ID = SERVICE.meeting.meeting_id;
const ACTION_ID = SERVICE.actions[0].action_id;
const POINT_ID = SERVICE.points[0].point_id;

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
        {
          meeting_id: MEETING_ID, subject: SERVICE.meeting.subject,
          people: ["Layla", "Omar"], date: "Thu 09 Oct",
        },
      ]));
    }
    if (req.method === "GET" && url.pathname === "/api/meetings/" + MEETING_ID) {
      return send(res, 200, JSON.stringify(SERVICE));
    }
    if (req.method === "GET" && url.pathname === "/api/search") {
      return send(res, 200, JSON.stringify({ hits: [] }));
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

test.beforeEach(async () => {
  postedTags.length = 0;
});

test("(S1) service page: meeting, person lists, assigned action, recording link", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await expect(page.getByRole("heading", { name: "Launch readiness" })).toBeVisible();
  await expect(page.locator(".degraded")).toHaveCount(0);
  // Top-level actions[] with owner/status: assigned, not the old suggested fallback.
  const action = page.locator(".ucol.u-medium .act").first();
  await expect(action).toHaveClass(/asg/);
  await expect(action.locator(".badge.as")).toHaveText("Assigned");
  await expect(action).toContainText("Layla");
  // Per-person id lists: Layla owns the point; nothing relevant from others.
  await page.locator('.person[data-person="Layla"]').click();
  const panel = page.locator(".panel");
  await expect(panel).toContainText("Owns RTL.");
  await expect(panel).toContainText("Launch moves to Nov 12");
  await expect(panel.locator("li.empty")).toHaveCount(1);
  // Recorder convention, served by notes_service.
  await expect(page.locator(".recoff")).toContainText(
    "recordings/" + MEETING_ID + ".webm");
  await expect(page.locator("audio#rec")).toHaveAttribute(
    "src", "/api/audio?meeting_id=" + MEETING_ID);
});

test("(S2) service page: action re-tag posts the action id and flips to by you", async ({ page }) => {
  await page.goto(baseURL + "/?meeting=" + MEETING_ID);
  await page.locator(".ucol.u-medium .act details.retag summary").click();
  await page.locator('[data-retag="' + ACTION_ID + '"][data-val="urgent"]').click();
  await expect.poll(() => postedTags.length, { timeout: 5000 }).toBe(1);
  expect(postedTags[0]).toEqual({ target: "action", target_id: ACTION_ID, urgency: "urgent" });
  await expect(page.locator("summary", { hasText: "by you" }).first()).toBeVisible();
  await expect(page.locator(".ucol.u-urgent")).toContainText("Launch moves to Nov 12");
  expect(POINT_ID).not.toEqual(ACTION_ID);
});
