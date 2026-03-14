import express from "express";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogPrompt } from "./src/catalog.ts";
import { DEFAULT_WIDGET_SPEC, prepareWidgetSpec, renderSpecToHtml } from "./src/renderer.tsx";
import { normalizeSliderState } from "./src/tokens.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.UI_SERVER_PORT || 4200);
const TOKEN = process.env.UI_SERVER_TOKEN;
const DB_DIR = path.join(process.env.HOME || process.cwd(), ".ui-server");
const DB_PATH = path.join(DB_DIR, "widgets.db");
const SHELL_PATH = path.join(__dirname, "public", "shell.html");
const OPENCLAW_WEBHOOK = process.env.OPENCLAW_REFINE_WEBHOOK_URL || null;

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
const app = express();
const clients = new Map();
const catalogPrompt = buildCatalogPrompt();

db.exec(`
  CREATE TABLE IF NOT EXISTS widgets (
    slug TEXT PRIMARY KEY,
    html TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT 'Widget',
    spec TEXT,
    tokens TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

ensureColumn("spec", "TEXT");
ensureColumn("tokens", "TEXT");

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "dist", "client")));

function ensureColumn(name, definition) {
  const existing = db.prepare("PRAGMA table_info(widgets)").all();
  if (!existing.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE widgets ADD COLUMN ${name} ${definition}`);
  }
}

function sanitizeSlug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function requireToken(req, res, next) {
  if (!TOKEN) {
    next();
    return;
  }

  if ((req.headers.authorization || "") !== `Bearer ${TOKEN}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeForInlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function readShellTemplate() {
  return fs.readFileSync(SHELL_PATH, "utf8");
}

function shellPage({ slug, title, spec, tokens, html }) {
  const template = readShellTemplate();
  const boot = {
    slug,
    title,
    spec: spec || DEFAULT_WIDGET_SPEC,
    tokens: tokens ?? null,
  };

  return template
    .replace("__PAGE_TITLE__", escapeHtml(title))
    .replace("__WIDGET_CONTENT__", html)
    .replace("__WIDGET_BOOT_PAYLOAD__", escapeForInlineJson(boot));
}

function parseTokens(value) {
  if (!value) {
    return null;
  }
  try {
    return normalizeSliderState(JSON.parse(value));
  } catch {
    return null;
  }
}

function broadcast(slug, payload) {
  const listeners = clients.get(slug);
  if (!listeners) {
    return;
  }

  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const response of listeners) {
    try {
      response.write(message);
    } catch {
      // Ignore closed sockets.
    }
  }
}

app.put("/widget/:slug", requireToken, (req, res) => {
  const slug = sanitizeSlug(req.params.slug);
  const title = String(req.body.title || "Widget");
  const spec = typeof req.body.spec === "string" ? req.body.spec : null;
  const tokenState = req.body.tokens ? normalizeSliderState(req.body.tokens) : null;

  if (!spec) {
    res.status(400).json({ error: "spec required" });
    return;
  }

  const prepared = prepareWidgetSpec(spec);
  if (prepared.error) {
    res.status(400).json({ error: prepared.error });
    return;
  }

  const html = renderSpecToHtml(spec);
  const existing = db.prepare("SELECT slug FROM widgets WHERE slug = ?").get(slug);
  if (existing) {
    db.prepare(`
      UPDATE widgets
      SET spec = ?, html = ?, title = ?, tokens = COALESCE(?, tokens), updated_at = datetime('now')
      WHERE slug = ?
    `).run(spec, html, title, tokenState ? JSON.stringify(tokenState) : null, slug);
  } else {
    db.prepare(`
      INSERT INTO widgets (slug, spec, html, title, tokens)
      VALUES (?, ?, ?, ?, ?)
    `).run(slug, spec, html, title, tokenState ? JSON.stringify(tokenState) : null);
  }

  broadcast(slug, { type: "spec", spec });
  res.json({ slug, url: `https://ui.scty.org/widget/${slug}` });
});

app.put("/widget/:slug/tokens", (req, res) => {
  const slug = sanitizeSlug(req.params.slug);
  const row = db.prepare("SELECT slug FROM widgets WHERE slug = ?").get(slug);
  if (!row) {
    res.status(404).json({ error: "Widget not found" });
    return;
  }

  const tokens = normalizeSliderState(req.body.tokens);
  db.prepare("UPDATE widgets SET tokens = ?, updated_at = datetime('now') WHERE slug = ?")
    .run(JSON.stringify(tokens), slug);
  res.json({ ok: true });
});

app.get("/widget/:slug", (req, res) => {
  const slug = sanitizeSlug(req.params.slug);
  const row = db.prepare("SELECT * FROM widgets WHERE slug = ?").get(slug);
  if (!row) {
    res.status(404).send("Widget not found");
    return;
  }

  const spec = row.spec || DEFAULT_WIDGET_SPEC;
  const html = row.html || renderSpecToHtml(spec);
  const tokens = parseTokens(row.tokens);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(shellPage({
    slug: row.slug,
    title: row.title,
    spec,
    tokens,
    html,
  }));
});

app.get("/widget/:slug/events", (req, res) => {
  const slug = sanitizeSlug(req.params.slug);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(": connected\n\n");

  if (!clients.has(slug)) {
    clients.set(slug, new Set());
  }
  clients.get(slug).add(res);

  const keepalive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      // Ignore closed sockets.
    }
  }, 20000);

  req.on("close", () => {
    clearInterval(keepalive);
    clients.get(slug)?.delete(res);
    if (clients.get(slug)?.size === 0) {
      clients.delete(slug);
    }
  });
});

app.post("/widget/:slug/refine", async (req, res) => {
  const slug = sanitizeSlug(req.params.slug);
  const message = String(req.body.message || "").trim();
  if (!message) {
    res.status(400).json({ error: "message required" });
    return;
  }

  const row = db.prepare("SELECT spec, title FROM widgets WHERE slug = ?").get(slug);
  const currentSpec = typeof req.body.currentSpec === "string" && req.body.currentSpec.trim()
    ? req.body.currentSpec
    : row?.spec || DEFAULT_WIDGET_SPEC;

  console.log(`[refine] ${slug}: ${message}`);

  if (OPENCLAW_WEBHOOK) {
    try {
      await fetch(OPENCLAW_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          message,
          currentSpec,
          title: row?.title || "Widget",
          catalogPrompt,
          instructions: [
            "You are generating a json-render YAML spec for a UI widget.",
            "Output only valid YAML with one root-level array of components.",
            "Use only the allowed components described in catalogPrompt.",
            "Keep existing components that do not need to change.",
            "Return a full replacement spec.",
          ].join("\n"),
        }),
      });
    } catch (error) {
      console.error("[refine] webhook error:", error instanceof Error ? error.message : error);
      res.status(502).json({ error: "webhook failed" });
      return;
    }
  }

  res.json({ ok: true });
});

app.get("/widgets", requireToken, (_req, res) => {
  const rows = db.prepare("SELECT slug, title, updated_at FROM widgets ORDER BY updated_at DESC").all();
  res.json(rows);
});

app.get("/health", (_req, res) => {
  const widgets = db.prepare("SELECT COUNT(*) AS count FROM widgets").get();
  res.json({ ok: true, widgets: widgets.count });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ui-scty running on http://127.0.0.1:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Auth: ${TOKEN ? "enabled" : "disabled"}`);
});
