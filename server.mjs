import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleDebate } from "./src/routes/debate-route.mjs";
import { handleFollowUp } from "./src/routes/followup-route.mjs";
import { handleHealth } from "./src/routes/health-route.mjs";
import { handleShowcaseSnapshot } from "./src/routes/showcase-route.mjs";
import { securityHeaders, sendJson } from "./src/utils/http.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const debateRuntimeMs = Number(process.env.FLOOR_DEBATE_MS || 90000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      handleHealth(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/debate") {
      await handleDebate(request, response, url, { debateRuntimeMs });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/showcase-snapshot") {
      await handleShowcaseSnapshot(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/followup") {
      await handleFollowUp(request, response);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Internal server error" });
    } else {
      response.end();
    }
  }
});

server.on("error", (error) => {
  console.error(`The Floor failed to start: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`The Floor is running at http://localhost:${actualPort}`);
});

async function serveStatic(pathname, response) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(normalized).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    const ext = path.extname(filePath);
    response.writeHead(200, securityHeaders({
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    }));
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}
