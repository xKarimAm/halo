// Fake Meet server: static files plus Meet-like CSP + Trusted Types headers,
// so innerHTML-style DOM building fails here the way it fails on Meet.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
export const HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src blob: 'self'; connect-src 'self' ws: wss:",
  "require-trusted-types-for": "'script'",
  "trusted-types": "halo-fake",
};

export function createFakeMeetServer() {
  return createServer(async (req, res) => {
    // Meet is one page at any meeting path (/<code> or /meet/<code>, both
    // seen live): every extensionless path serves the page.
    const path = (req.url || "/").split("?")[0];
    const name = extname(path) ? path : "/index.html";
    try {
      const body = await readFile(join(root, name));
      res.writeHead(200, { "content-type": types[extname(name)] || "application/octet-stream", ...HEADERS });
      res.end(body);
    } catch {
      res.writeHead(404, HEADERS);
      res.end("not found");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 18778);
  createFakeMeetServer().listen(port, "127.0.0.1", () => console.log(`fake meet on ${port}`));
}
