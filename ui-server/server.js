const fs = require("fs");
const path = require("path");

const Database = require("better-sqlite3");
const express = require("express");

const app = express();
const port = 4200;
const publicUrlBase = "https://ui.scty.org";
const dbPath = process.env.UI_SERVER_DB_PATH || "/home/deploy/.ui-server/widgets.db";
const slugPattern = /^[a-z0-9-]+$/;
const clientsBySlug = new Map();

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS widgets (
    slug TEXT PRIMARY KEY,
    html TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const readWidget = db.prepare(
  "SELECT slug, html, title, created_at, updated_at FROM widgets WHERE slug = ?"
);
const upsertWidget = db.prepare(`
  INSERT INTO widgets (slug, html, title, created_at, updated_at)
  VALUES (@slug, @html, @title, @now, @now)
  ON CONFLICT(slug) DO UPDATE SET
    html = excluded.html,
    title = excluded.title,
    updated_at = excluded.updated_at
`);

app.use(express.json({ limit: "2mb" }));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateSlug(slug) {
  return slugPattern.test(slug);
}

function requireToken(req, res, next) {
  const expectedToken = process.env.UI_SERVER_TOKEN;
  if (!expectedToken) {
    return res.status(500).json({ error: "UI_SERVER_TOKEN is not configured" });
  }

  const authHeader = req.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function renderShell(widget) {
  const slugJson = JSON.stringify(widget.slug);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(widget.title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/morphdom@2.7.2/dist/morphdom.min.js"></script>
    <style>
      :root {
        color-scheme: dark;
        font-family: system-ui, sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: #0d0d1a;
        color: #f5f7ff;
      }

      main {
        min-height: 100vh;
        padding: 24px 24px 112px;
      }

      #widget-content {
        min-height: calc(100vh - 136px);
      }

      .refine-bar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        gap: 12px;
        padding: 16px 20px 20px;
        background: rgba(10, 10, 18, 0.94);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(12px);
      }

      .refine-input {
        flex: 1;
        min-height: 52px;
        max-height: 160px;
        resize: vertical;
        padding: 14px 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        color: inherit;
      }

      .refine-button {
        align-self: flex-end;
        height: 52px;
        padding: 0 18px;
        border: 0;
        border-radius: 14px;
        background: #7c8cff;
        color: #0d0d1a;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .refine-status {
        position: fixed;
        right: 22px;
        bottom: 88px;
        color: rgba(245, 247, 255, 0.72);
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main>
      <div id="widget-content">${widget.html}</div>
    </main>
    <form class="refine-bar" id="refine-form">
      <textarea
        class="refine-input"
        id="refine-message"
        name="message"
        placeholder="Refine this widget..."
        required
      ></textarea>
      <button class="refine-button" type="submit">Refine</button>
    </form>
    <div class="refine-status" id="refine-status"></div>
    <script>
      const slug = ${slugJson};
      let content = document.getElementById("widget-content");
      const refineForm = document.getElementById("refine-form");
      const refineMessage = document.getElementById("refine-message");
      const refineStatus = document.getElementById("refine-status");

      function rerunScripts(container) {
        for (const script of container.querySelectorAll("script")) {
          const nextScript = document.createElement("script");
          for (const attribute of script.attributes) {
            nextScript.setAttribute(attribute.name, attribute.value);
          }
          nextScript.textContent = script.textContent;
          script.replaceWith(nextScript);
        }
      }

      const events = new EventSource("/widget/" + slug + "/events");
      events.addEventListener("update", (event) => {
        const payload = JSON.parse(event.data);
        const nextContent = document.createElement("div");
        nextContent.id = "widget-content";
        nextContent.innerHTML = payload.html;
        morphdom(content, nextContent);
        content = document.getElementById("widget-content");
        rerunScripts(content);
        if (payload.title) {
          document.title = payload.title;
        }
      });

      refineForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const message = refineMessage.value.trim();
        if (!message) {
          return;
        }

        refineStatus.textContent = "Submitting...";

        try {
          const response = await fetch("/widget/" + slug + "/refine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
          });

          if (!response.ok) {
            throw new Error("Refine request failed");
          }

          refineMessage.value = "";
          refineStatus.textContent = "Sent";
          setTimeout(() => {
            if (refineStatus.textContent === "Sent") {
              refineStatus.textContent = "";
            }
          }, 2000);
        } catch (error) {
          refineStatus.textContent = "Failed";
        }
      });
    </script>
  </body>
</html>`;
}

function sendEvent(slug, payload) {
  const clients = clientsBySlug.get(slug);
  if (!clients || clients.size === 0) {
    return;
  }

  const message = `event: update\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

app.put("/widget/:slug", requireToken, (req, res) => {
  const { slug } = req.params;
  const { html, title } = req.body || {};

  if (!validateSlug(slug)) {
    return res.status(400).json({ error: "Invalid slug" });
  }

  if (typeof html !== "string" || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "html and title are required" });
  }

  const now = new Date().toISOString();
  upsertWidget.run({
    slug,
    html,
    title: title.trim(),
    now
  });

  sendEvent(slug, { type: "update", html, title: title.trim() });
  res.json({ url: `${publicUrlBase}/widget/${slug}` });
});

app.get("/widget/:slug", (req, res) => {
  const widget = readWidget.get(req.params.slug);
  if (!widget) {
    return res.status(404).type("text/plain").send("Widget not found");
  }

  res.type("html").send(renderShell(widget));
});

app.get("/widget/:slug/events", (req, res) => {
  const { slug } = req.params;
  if (!validateSlug(slug)) {
    return res.status(400).type("text/plain").send("Invalid slug");
  }

  res.set({
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders();
  res.write(": connected\n\n");

  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15000);

  const clients = clientsBySlug.get(slug) || new Set();
  clients.add(res);
  clientsBySlug.set(slug, clients);

  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(res);
    if (clients.size === 0) {
      clientsBySlug.delete(slug);
    }
  });
});

app.post("/widget/:slug/refine", (req, res) => {
  const { slug } = req.params;
  const { message } = req.body || {};
  const widget = readWidget.get(slug);

  if (!validateSlug(slug)) {
    return res.status(400).json({ error: "Invalid slug" });
  }

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  console.log(
    JSON.stringify({
      type: "widget.refine",
      slug,
      message: message.trim(),
      currentHtml: widget ? widget.html : null,
      timestamp: new Date().toISOString()
    })
  );

  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`ui-server listening on http://localhost:${port}`);
});
