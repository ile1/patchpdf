/**
 * patchpdf engine — browser-side surgical PDF editor
 * Copyright (c) 2026 Martial Systems LLC.
 *
 * Fully client-side: extract → plan → apply. No server PDF processing.
 * OpenAI-compatible planning calls the user's provider (direct or thin proxy).
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
} from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
} from "https://cdn.jsdelivr.net/npm/docx@9.5.1/+esm";

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

/** Built-in OpenAI-compatible profiles (keys stay in the browser). */
export const BUILTIN_PROFILES = {
  local: {
    id: "local",
    label: "Local patterns only",
    kind: "local",
    notes: "No network. replace / watermark / delete / meta patterns.",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  xai: {
    id: "xai",
    label: "xAI (Grok)",
    kind: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-3-mini",
    apiKeyEnv: "XAI_API_KEY",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4.1-mini",
    apiKeyEnv: "OPENROUTER_API_KEY",
    headers: {
      "HTTP-Referer": "https://martialgames.net/tools/patchpdf/",
      "X-Title": "patchpdf",
    },
  },
  groq: {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
  },
  together: {
    id: "together",
    label: "Together AI",
    kind: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    model: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    apiKeyEnv: "TOGETHER_API_KEY",
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
    defaultApiKey: "ollama",
    notes: "Enable CORS on Ollama. Keys optional.",
  },
  custom: {
    id: "custom",
    label: "Custom OpenAI-compatible",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "local-model",
    notes: "Set base URL + model in the UI.",
  },
};

export function listProfiles() {
  return Object.values(BUILTIN_PROFILES).map((p) => ({ ...p }));
}

function copyBytes(pdfBytes) {
  const out = new Uint8Array(pdfBytes.byteLength);
  out.set(pdfBytes);
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hexToRgb(hex) {
  if (!hex) return rgb(0.1, 0.1, 0.1);
  const h = String(hex).replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6) return rgb(0.1, 0.1, 0.1);
  const n = parseInt(full, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function pageIndex(page, pageCount) {
  if (page < 1 || page > pageCount) return null;
  return page - 1;
}

function parsePageList(s) {
  const out = [];
  for (const part of String(s).split(",")) {
    const t = part.trim();
    if (!t) continue;
    if (t.includes("-")) {
      const [a, b] = t.split("-").map((x) => parseInt(x.trim(), 10));
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
      }
    } else {
      const n = parseInt(t, 10);
      if (!Number.isNaN(n)) out.push(n);
    }
  }
  return out;
}

/* ─── Schema validation (no zod in browser build) ─── */

const OP_KINDS = new Set([
  "replace_text",
  "replace_line",
  "cover",
  "redact", // alias → cover (deprecated name)
  "add_text",
  "watermark",
  "set_metadata",
  "fill_form",
  "delete_pages",
  "rotate_pages",
  "draw_rect",
]);

const MAX_OPS = 200;

/**
 * Validate and normalize plan operations. Rejects unknown shapes.
 * @returns {{ operations: object[], warnings: string[] }}
 */
export function validateOperations(rawOps) {
  const warnings = [];
  if (!Array.isArray(rawOps)) {
    throw new Error("Plan operations must be an array");
  }
  if (rawOps.length > MAX_OPS) {
    throw new Error(`Too many operations (${rawOps.length}); max ${MAX_OPS}`);
  }
  const operations = [];
  for (let i = 0; i < rawOps.length; i++) {
    const op = rawOps[i];
    if (!op || typeof op !== "object" || typeof op.op !== "string") {
      warnings.push(`op[${i}]: skipped (not an object with op)`);
      continue;
    }
    let kind = op.op;
    if (kind === "redact") {
      kind = "cover";
      warnings.push(`op[${i}]: "redact" renamed to "cover" (visual cover only)`);
    }
    if (!OP_KINDS.has(kind) && kind !== "cover") {
      warnings.push(`op[${i}]: unknown op "${op.op}" skipped`);
      continue;
    }
    const n = { ...op, op: kind };
    // Light field checks
    if (kind === "replace_line") {
      if (typeof n.find !== "string" || typeof n.replace !== "string") {
        warnings.push(`op[${i}]: replace_line needs find/replace strings`);
        continue;
      }
      if (n.page != null) n.page = Number(n.page);
      if (n.id != null) n.id = Number(n.id);
      n.fit = n.fit !== false;
    } else if (kind === "replace_text" || kind === "cover") {
      if (typeof n.find !== "string") {
        warnings.push(`op[${i}]: ${kind} needs find string`);
        continue;
      }
      if (kind === "replace_text" && typeof n.replace !== "string") {
        warnings.push(`op[${i}]: replace_text needs replace string`);
        continue;
      }
      if (n.page != null) n.page = Number(n.page);
      if (kind === "replace_text") n.fit = n.fit !== false;
    } else if (kind === "add_text") {
      n.page = Number(n.page);
      n.x = Number(n.x);
      n.y = Number(n.y);
      if (!n.text || Number.isNaN(n.page)) {
        warnings.push(`op[${i}]: add_text invalid`);
        continue;
      }
    } else if (kind === "watermark") {
      if (!n.text) {
        warnings.push(`op[${i}]: watermark needs text`);
        continue;
      }
    } else if (kind === "delete_pages" || kind === "rotate_pages") {
      if (!Array.isArray(n.pages) || !n.pages.length) {
        warnings.push(`op[${i}]: needs pages array`);
        continue;
      }
      n.pages = n.pages.map(Number).filter((p) => p >= 1);
      if (kind === "rotate_pages") {
        const d = Number(n.degrees);
        if (![90, 180, 270].includes(d)) {
          warnings.push(`op[${i}]: rotate degrees must be 90|180|270`);
          continue;
        }
        n.degrees = d;
      }
    } else if (kind === "draw_rect") {
      n.page = Number(n.page);
      n.x = Number(n.x);
      n.y = Number(n.y);
      n.width = Number(n.width);
      n.height = Number(n.height);
    } else if (kind === "fill_form") {
      if (!n.fields || typeof n.fields !== "object") {
        warnings.push(`op[${i}]: fill_form needs fields object`);
        continue;
      }
    }
    operations.push(n);
  }
  return { operations, warnings };
}

export function parsePlan(raw) {
  let text = String(raw ?? "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Model did not return JSON plan. Got: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(json.operations)) {
    throw new Error("Plan missing operations array");
  }
  const { operations, warnings } = validateOperations(json.operations);
  return {
    summary: json.summary || "Applied edits",
    operations,
    parseWarnings: warnings,
  };
}

/* ─── Extract ─── */

export async function extractSnapshot(pdfBytes) {
  const forLib = copyBytes(pdfBytes);
  const forText = copyBytes(pdfBytes);

  const doc = await PDFDocument.load(forLib, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pageCount = doc.getPageCount();
  const pageSizes = doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width, height };
  });

  let formFields = [];
  try {
    const form = doc.getForm();
    formFields = form.getFields().map((f) => {
      let value = "";
      try {
        if (typeof f.getText === "function") value = String(f.getText() ?? "");
        else if (typeof f.isChecked === "function") value = String(f.isChecked());
        else if (typeof f.getSelected === "function") {
          const sel = f.getSelected();
          value = Array.isArray(sel) ? sel.join(", ") : String(sel ?? "");
        }
      } catch {
        /* ignore */
      }
      return {
        name: f.getName(),
        type: f.constructor?.name?.replace(/^PDF/, "") ?? "Field",
        value,
      };
    });
  } catch {
    formFields = [];
  }

  const metadata = {
    title: doc.getTitle() || undefined,
    author: doc.getAuthor() || undefined,
    subject: doc.getSubject() || undefined,
    keywords: doc.getKeywords() || undefined,
    creator: doc.getCreator() || undefined,
    producer: doc.getProducer() || undefined,
  };

  let fullText = "";
  let textByPage = [];
  let textItems = [];

  try {
    const loadingTask = pdfjs.getDocument({ data: forText, useSystemFonts: true });
    const pdf = await loadingTask.promise;
    textByPage = [];
    textItems = [];
    let id = 0;

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const strings = [];
      const pageItems = [];

      for (const item of content.items) {
        if (!item || typeof item.str !== "string" || !item.str.trim()) continue;
        // pdf.js transform: [scaleX, skewY, skewX, scaleY, tx, ty]
        const t = item.transform || [1, 0, 0, 1, 0, 0];
        const x = t[4];
        const y = t[5];
        const fontSize = Math.hypot(t[0], t[1]) || item.height || 12;
        const width = item.width ?? fontSize * item.str.length * 0.5;
        const height = item.height || fontSize;
        pageItems.push({
          id: id++,
          str: item.str,
          x,
          y,
          width,
          height,
          fontSize,
          page: p,
        });
        strings.push(item.str);
      }

      pageItems.sort((a, b) => {
        const dy = Math.abs(a.y - b.y) > 2 ? b.y - a.y : 0;
        if (dy !== 0) return dy > 0 ? 1 : -1;
        return a.x - b.x;
      });
      // re-id after sort for stable reading order in UI
      for (const it of pageItems) {
        it.id = textItems.length;
        textItems.push(it);
      }
      textByPage.push(strings.join(" "));
    }

    fullText = textByPage.join("\n\n--- page break ---\n\n");
  } catch (err) {
    fullText = `(text extraction failed: ${err instanceof Error ? err.message : String(err)})`;
    textByPage = Array.from({ length: pageCount }, () => "");
  }

  return {
    pageCount,
    pageSizes,
    textByPage,
    fullText,
    textItems,
    formFields,
    metadata,
  };
}

/**
 * Compact snapshot for LLM context.
 * No hard product character cap — only a soft safety ceiling for API body size
 * (default 400k chars ≈ large invoices). Pass maxChars: Infinity to disable.
 */
export function snapshotForPrompt(snapshot, maxChars = 400_000) {
  const lines = [];
  lines.push(`Pages: ${snapshot.pageCount}`);
  lines.push(
    `Page sizes: ${snapshot.pageSizes.map((s, i) => `p${i + 1}=${Math.round(s.width)}x${Math.round(s.height)}`).join(", ")}`,
  );
  if (Object.values(snapshot.metadata || {}).some(Boolean)) {
    lines.push(`Metadata: ${JSON.stringify(snapshot.metadata)}`);
  }
  if (snapshot.formFields?.length) {
    lines.push(
      `Form fields: ${snapshot.formFields.map((f) => `${f.name}(${f.type})=${JSON.stringify(f.value)}`).join("; ")}`,
    );
  }

  if (snapshot.textItems?.length) {
    // All numbered lines — no 200-line cap for client-side (user pays own tokens)
    const numbered = snapshot.textItems
      .map(
        (t) =>
          `#${t.id} [p${t.page} size=${Math.round(t.fontSize)}] ${JSON.stringify(String(t.str).slice(0, 200))}`,
      )
      .join("\n");
    lines.push(`\nEditable lines (prefer replace_line with id):\n${numbered}`);
  }

  let textBudget =
    maxChars === Infinity
      ? Number.MAX_SAFE_INTEGER
      : maxChars - lines.join("\n").length - 200;

  for (let i = 0; i < snapshot.textByPage.length; i++) {
    const pageText = snapshot.textByPage[i] || "(empty)";
    const header = `\n--- Page ${i + 1} ---\n`;
    if (textBudget <= 0) {
      lines.push(`\n... (${snapshot.textByPage.length - i} more pages truncated for prompt size)`);
      break;
    }
    const chunk = pageText.slice(0, textBudget);
    lines.push(header + chunk);
    textBudget -= header.length + chunk.length;
  }

  return lines.join("\n");
}

export function opsFromHumanEdits(input) {
  const operations = [];
  let changed = 0;
  for (const row of input.items || []) {
    if (row.edited === row.original) continue;
    operations.push({
      op: "replace_line",
      id: row.id,
      page: row.page,
      find: row.original,
      replace: row.edited,
      fit: true,
    });
    changed++;
  }
  if (input.metadata && input.originalMetadata) {
    const patch = { op: "set_metadata" };
    let any = false;
    for (const key of ["title", "author", "subject"]) {
      if (
        input.metadata[key] != null &&
        input.metadata[key] !== (input.originalMetadata[key] || "")
      ) {
        patch[key] = input.metadata[key];
        any = true;
      }
    }
    if (any) {
      operations.push(patch);
      changed++;
    }
  }
  return { operations, changed };
}

/* ─── Apply ─── */

function findMatches(items, find, page) {
  const needle = find.toLowerCase();
  return items.filter((it) => {
    if (page != null && it.page !== page) return false;
    return it.str.toLowerCase().includes(needle);
  });
}

function coverAndWrite(page, font, item, newText, opts = {}) {
  const pad = 1.2;
  let size = item.fontSize || 12;
  const boxW = Math.max(item.width, 4);
  const fit = opts.fit !== false;

  if (!opts.coverOnly && newText && fit) {
    let guard = 0;
    while (
      guard++ < 80 &&
      size > 5.5 &&
      font.widthOfTextAtSize(newText, size) > boxW * 1.02
    ) {
      size -= 0.2;
    }
  }

  const textWidth =
    newText && !opts.coverOnly ? font.widthOfTextAtSize(newText, size) : 0;
  const coverW = Math.max(boxW, textWidth) + pad * 2;
  const coverH = Math.max(item.height, item.fontSize || size, size) + pad * 2;

  page.drawRectangle({
    x: item.x - pad,
    y: item.y - pad * 0.6,
    width: coverW,
    height: coverH,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });

  if (!opts.coverOnly && newText) {
    page.drawText(newText, {
      x: item.x,
      y: item.y,
      size,
      font,
      color: hexToRgb(opts.color),
    });
  }
}

function resolveLineTarget(textItems, op) {
  if (op.id != null) {
    const byId = textItems.find((t) => t.id === op.id);
    if (byId && byId.str === op.find && byId.page === op.page) return byId;
    if (byId && byId.page === op.page) return byId;
  }
  const same = textItems.filter((t) => t.page === op.page && t.str === op.find);
  if (!same.length) {
    const soft = textItems.filter(
      (t) => t.page === op.page && t.str.includes(op.find),
    );
    if (soft.length === 1) return soft[0];
    if (op.itemIndex != null && soft[op.itemIndex]) return soft[op.itemIndex];
    return soft[0] ?? null;
  }
  if (op.itemIndex != null && same[op.itemIndex]) return same[op.itemIndex];
  return same[0];
}

export async function applyOperations(pdfBytes, operations) {
  const { operations: ops, warnings: valWarnings } = validateOperations(operations);
  const applied = [];
  const warnings = [...valWarnings];

  const snapshot = await extractSnapshot(pdfBytes);
  const textItems = snapshot.textItems;
  const source = copyBytes(pdfBytes);

  const doc = await PDFDocument.load(source, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const contentOps = ops.filter((o) => o.op !== "delete_pages");
  const deleteOps = ops.filter((o) => o.op === "delete_pages");

  for (const op of contentOps) {
    try {
      switch (op.op) {
        case "replace_line": {
          const target = resolveLineTarget(textItems, op);
          if (!target) {
            warnings.push(`replace_line: no match for "${op.find}" on page ${op.page}`);
            break;
          }
          const idx = pageIndex(target.page, doc.getPageCount());
          if (idx == null) break;
          coverAndWrite(doc.getPage(idx), font, target, op.replace, {
            fit: op.fit !== false,
          });
          applied.push(
            `replace_line #${target.id} p${target.page}: "${String(op.find).slice(0, 40)}" → "${String(op.replace).slice(0, 40)}"`,
          );
          break;
        }
        case "replace_text": {
          const matches = findMatches(textItems, op.find, op.page);
          if (!matches.length) {
            warnings.push(`replace_text: no match for "${op.find}"`);
            break;
          }
          const targets = op.all === false ? matches.slice(0, 1) : matches;
          for (const m of targets) {
            const idx = pageIndex(m.page, doc.getPageCount());
            if (idx == null) continue;
            let newStr = m.str;
            if (m.str.toLowerCase().includes(op.find.toLowerCase())) {
              const re = new RegExp(escapeRegExp(op.find), "gi");
              newStr = m.str.replace(re, op.replace);
            } else {
              newStr = op.replace;
            }
            coverAndWrite(doc.getPage(idx), font, m, newStr, {
              fit: op.fit !== false,
            });
          }
          applied.push(
            `replace_text "${op.find}" → "${op.replace}" (${targets.length} hits)`,
          );
          break;
        }
        case "cover": {
          const matches = findMatches(textItems, op.find, op.page);
          if (!matches.length) {
            warnings.push(`cover: no match for "${op.find}"`);
            break;
          }
          for (const m of matches) {
            const idx = pageIndex(m.page, doc.getPageCount());
            if (idx == null) continue;
            coverAndWrite(doc.getPage(idx), font, m, "", { coverOnly: true });
          }
          applied.push(
            `cover "${op.find}" (${matches.length} hits — visual only, not forensic redaction)`,
          );
          break;
        }
        case "add_text": {
          const idx = pageIndex(op.page, doc.getPageCount());
          if (idx == null) {
            warnings.push(`add_text: invalid page ${op.page}`);
            break;
          }
          doc.getPage(idx).drawText(op.text, {
            x: op.x,
            y: op.y,
            size: op.size ?? 12,
            font,
            color: hexToRgb(op.color),
          });
          applied.push(`add_text on page ${op.page}`);
          break;
        }
        case "watermark": {
          const text = op.text;
          const size = op.size ?? 48;
          const angle = op.angle ?? -35;
          const opacity = op.opacity ?? 0.15;
          for (const page of doc.getPages()) {
            const { width, height } = page.getSize();
            const tw = fontBold.widthOfTextAtSize(text, size);
            page.drawText(text, {
              x: Math.max(24, (width - tw) / 2),
              y: height / 2,
              size,
              font: fontBold,
              color: rgb(0.5, 0.5, 0.5),
              opacity,
              rotate: degrees(angle),
            });
          }
          applied.push(`watermark "${text}"`);
          break;
        }
        case "set_metadata": {
          if (op.title != null) doc.setTitle(op.title);
          if (op.author != null) doc.setAuthor(op.author);
          if (op.subject != null) doc.setSubject(op.subject);
          if (op.keywords != null) doc.setKeywords(op.keywords);
          if (op.creator != null) doc.setCreator(op.creator);
          doc.setModificationDate(new Date());
          applied.push("set_metadata");
          break;
        }
        case "fill_form": {
          try {
            const form = doc.getForm();
            let filled = 0;
            for (const [name, value] of Object.entries(op.fields)) {
              try {
                const field = form.getField(name);
                if (typeof value === "boolean" && typeof field.check === "function") {
                  if (value) field.check();
                  else field.uncheck?.();
                  filled++;
                } else if (typeof field.setText === "function") {
                  field.setText(String(value));
                  filled++;
                } else if (typeof field.select === "function") {
                  field.select(String(value));
                  filled++;
                } else {
                  warnings.push(`fill_form: unsupported field type for "${name}"`);
                }
              } catch {
                warnings.push(`fill_form: field not found "${name}"`);
              }
            }
            applied.push(`fill_form (${filled} fields)`);
          } catch (e) {
            warnings.push(`fill_form: ${e instanceof Error ? e.message : String(e)}`);
          }
          break;
        }
        case "rotate_pages": {
          for (const p of op.pages) {
            const idx = pageIndex(p, doc.getPageCount());
            if (idx == null) {
              warnings.push(`rotate_pages: invalid page ${p}`);
              continue;
            }
            const page = doc.getPage(idx);
            const current = page.getRotation().angle;
            page.setRotation(degrees((current + op.degrees) % 360));
          }
          applied.push(`rotate_pages ${op.pages.join(",")} by ${op.degrees}°`);
          break;
        }
        case "draw_rect": {
          const idx = pageIndex(op.page, doc.getPageCount());
          if (idx == null) {
            warnings.push(`draw_rect: invalid page ${op.page}`);
            break;
          }
          const color = hexToRgb(op.color ?? "#000000");
          doc.getPage(idx).drawRectangle({
            x: op.x,
            y: op.y,
            width: op.width,
            height: op.height,
            color: op.fill !== false ? color : undefined,
            borderColor: color,
            borderWidth: op.fill === false ? 1 : 0,
            opacity: op.opacity ?? 1,
          });
          applied.push(`draw_rect on page ${op.page}`);
          break;
        }
        default:
          warnings.push(`unknown op: ${op.op}`);
      }
    } catch (e) {
      warnings.push(`${op.op}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const op of deleteOps) {
    const sorted = [...new Set(op.pages)].sort((a, b) => b - a);
    for (const p of sorted) {
      const idx = pageIndex(p, doc.getPageCount());
      if (idx == null) {
        warnings.push(`delete_pages: invalid page ${p}`);
        continue;
      }
      doc.removePage(idx);
    }
    applied.push(`delete_pages ${op.pages.join(",")}`);
  }

  const bytes = await doc.save();
  return { bytes, applied, warnings };
}

/* ─── Local patterns ─── */

export function parseLocalOps(instruction) {
  const ops = [];
  const lower = instruction.toLowerCase();

  const rep =
    instruction.match(/replace\s+["'](.+?)["']\s+with\s+["'](.+?)["']/i) ||
    instruction.match(/change\s+["'](.+?)["']\s+to\s+["'](.+?)["']/i) ||
    instruction.match(/find\s+["'](.+?)["']\s+replace(?:\s+with)?\s+["'](.+?)["']/i);
  if (rep) {
    ops.push({
      op: "replace_text",
      find: rep[1],
      replace: rep[2],
      all: true,
      fit: true,
    });
  }

  const wm = instruction.match(/watermark\s+["'](.+?)["']/i);
  if (wm) ops.push({ op: "watermark", text: wm[1] });

  const title = instruction.match(/title\s+["'](.+?)["']/i);
  if (title) ops.push({ op: "set_metadata", title: title[1] });

  const del = instruction.match(/delete\s+pages?\s+([\d,\s-]+)/i);
  if (del) {
    const pages = parsePageList(del[1]);
    if (pages.length) ops.push({ op: "delete_pages", pages });
  }

  if (lower.includes("confidential") && lower.includes("watermark") && !wm) {
    ops.push({ op: "watermark", text: "CONFIDENTIAL" });
  }

  return ops;
}

export async function applyLocalInstruction(pdfBytes, instruction) {
  const ops = parseLocalOps(instruction);
  if (!ops.length) return null;
  const result = await applyOperations(pdfBytes, ops);
  return { ...result, operations: ops };
}

/* ─── AI plan (browser → provider; optional same-origin proxy for CORS) ─── */

const SYSTEM = `You are a PDF surgical editor for the patchpdf tool.
Given a PDF content snapshot and a user instruction, output ONLY a JSON object (no markdown fences) with this shape:
{
  "summary": "one-line description of the edit",
  "operations": [ ... ]
}

Available operations (use only these):
1. replace_line — PREFERRED. { "op":"replace_line", "id":0, "page":1, "find":"exact original string", "replace":"new string", "fit":true }
2. replace_text — { "op":"replace_text", "find":"snippet", "replace":"new", "page"?:1, "all"?:true, "fit"?:true }
3. cover — visual whiteout only (NOT forensic redaction). { "op":"cover", "find":"text", "page"?:number }
4. add_text — { "op":"add_text", "page":1, "x":number, "y":number, "text":"...", "size"?:12, "color"?:"#111111" }
5. watermark — { "op":"watermark", "text":"CONFIDENTIAL", "opacity"?:0.15, "angle"?:-35, "size"?:48 }
6. set_metadata — { "op":"set_metadata", "title"?:string, "author"?:string, "subject"?:string, "keywords"?:string[] }
7. fill_form — { "op":"fill_form", "fields": { "FieldName": "value" } }
8. delete_pages — { "op":"delete_pages", "pages":[2,3] }
9. rotate_pages — { "op":"rotate_pages", "pages":[1], "degrees":90 }
10. draw_rect — { "op":"draw_rect", "page":1, "x":0, "y":0, "width":100, "height":20, "color"?:"#ffffff", "fill"?:true }

Rules:
- Prefer replace_line with exact #id from the snapshot.
- Only change what the user asked. Leave everything else untouched.
- Always set "fit": true for text replacements.
- Never invent pages. Output JSON only.`;

const PROXY_HOSTS = new Set([
  "api.openai.com",
  "api.x.ai",
  "openrouter.ai",
  "api.groq.com",
  "api.together.xyz",
]);

function shouldUseProxy(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return PROXY_HOSTS.has(host);
  } catch {
    return false;
  }
}

async function chatCompletions({
  baseUrl,
  apiKey,
  model,
  headers = {},
  messages,
  timeoutMs = 90_000,
}) {
  const body = JSON.stringify({
    model,
    temperature: 0.1,
    messages,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const directUrl = `${String(baseUrl).replace(/\/$/, "")}/chat/completions`;
  const useProxy = shouldUseProxy(baseUrl);

  async function post(url, extra = {}) {
    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...headers,
        ...extra,
      },
      body,
      signal: controller.signal,
    });
  }

  try {
    let res;
    if (useProxy) {
      // Cloud providers block browser CORS — use same-origin allowlisted proxy
      res = await post("/api/llm-proxy", {
        "X-Patchpdf-Base-Url": String(baseUrl).replace(/\/$/, ""),
      });
    } else {
      // Local Ollama / custom gateways with CORS
      try {
        res = await post(directUrl);
      } catch (directErr) {
        throw new Error(
          `Could not reach ${baseUrl}. For local models enable CORS (Ollama). ` +
            `Cloud providers work via the site proxy automatically. ` +
            `(${directErr instanceof Error ? directErr.message : directErr})`,
        );
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `LLM API ${res.status}: ${errText.slice(0, 400) || res.statusText}`,
      );
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export async function planEdits({
  apiKey,
  model,
  baseUrl,
  headers = {},
  instruction,
  snapshot,
  maxChars = 400_000,
}) {
  if (!apiKey) {
    throw new Error("API key required for AI planning (or use Local patterns / line editor).");
  }
  if (!baseUrl) {
    throw new Error("baseUrl required for AI planning.");
  }

  const content = await chatCompletions({
    baseUrl,
    apiKey,
    model: model || "gpt-4.1-mini",
    headers,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `PDF SNAPSHOT:\n${snapshotForPrompt(snapshot, maxChars)}\n\nUSER INSTRUCTION:\n${instruction}\n\nReturn the JSON edit plan. Prefer replace_line with fit:true.`,
      },
    ],
  });

  return parsePlan(content);
}

export async function editPdf({
  pdfBytes,
  instruction,
  apiKey,
  model,
  baseUrl,
  headers,
  profile = "local",
  localOnly = false,
  plan,
  maxChars = 400_000,
  dryRun = false,
}) {
  const snapshot = await extractSnapshot(pdfBytes);
  const prof = BUILTIN_PROFILES[profile] || BUILTIN_PROFILES.local;

  if (plan) {
    const { operations } = validateOperations(plan.operations || []);
    if (dryRun) {
      return {
        bytes: pdfBytes,
        applied: [],
        warnings: [],
        plan: { summary: plan.summary || "Dry run", operations },
        snapshot,
        mode: "plan",
        profileId: profile,
      };
    }
    const result = await applyOperations(pdfBytes, operations);
    return {
      ...result,
      plan: { summary: plan.summary || "Applied plan", operations },
      snapshot,
      mode: "plan",
      profileId: profile,
    };
  }

  const useAi =
    !localOnly &&
    prof.kind !== "local" &&
    Boolean(apiKey || prof.defaultApiKey) &&
    Boolean(baseUrl || prof.baseUrl);

  if (useAi) {
    const planned = await planEdits({
      apiKey: apiKey || prof.defaultApiKey || "",
      model: model || prof.model,
      baseUrl: baseUrl || prof.baseUrl,
      headers: { ...(prof.headers || {}), ...(headers || {}) },
      instruction,
      snapshot,
      maxChars,
    });
    if (dryRun) {
      return {
        bytes: pdfBytes,
        applied: [],
        warnings: planned.parseWarnings || [],
        plan: planned,
        snapshot,
        mode: "ai",
        profileId: prof.id,
      };
    }
    const result = await applyOperations(pdfBytes, planned.operations);
    return {
      ...result,
      warnings: [...(planned.parseWarnings || []), ...result.warnings],
      plan: planned,
      snapshot,
      mode: "ai",
      profileId: prof.id,
    };
  }

  const local = await applyLocalInstruction(pdfBytes, instruction);
  if (local) {
    return {
      bytes: local.bytes,
      applied: local.applied,
      warnings: local.warnings,
      plan: {
        summary: local.applied.join("; ") || "Local pattern edit",
        operations: local.operations,
      },
      snapshot,
      mode: "local",
      profileId: "local",
    };
  }

  throw new Error(
    "No AI credentials and instruction did not match local patterns.\n" +
      'Try: replace "old" with "new" | watermark "DRAFT" | delete pages 2 | Or pick a provider + API key.',
  );
}

/* ─── DOCX export (layout-approx) ─── */

const PT_TO_TWIP = 20;

function groupIntoLines(items, page) {
  const pageItems = items
    .filter((t) => t.page === page && t.str.trim())
    .slice()
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 1.5) return b.y - a.y;
      return a.x - b.x;
    });

  const lines = [];
  for (const it of pageItems) {
    const threshold = Math.max(3, (it.fontSize || 12) * 0.45);
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= threshold) {
      last.runs.push({ str: it.str, x: it.x, fontSize: it.fontSize || 12 });
      last.minX = Math.min(last.minX, it.x);
      last.maxX = Math.max(last.maxX, it.x + it.width);
      last.fontSize = Math.max(last.fontSize, it.fontSize || 12);
      last.y = (last.y + it.y) / 2;
    } else {
      lines.push({
        page,
        y: it.y,
        fontSize: it.fontSize || 12,
        minX: it.x,
        maxX: it.x + it.width,
        runs: [{ str: it.str, x: it.x, fontSize: it.fontSize || 12 }],
      });
    }
  }
  for (const line of lines) line.runs.sort((a, b) => a.x - b.x);
  return lines;
}

export async function exportPdfToDocx(pdfBytes, options = {}) {
  const warnings = [];
  const snapshot = await extractSnapshot(pdfBytes);
  if (!snapshot.textItems.length) {
    warnings.push("Little positioned text — export may be plain per page.");
  }

  const sections = [];
  let totalLines = 0;

  for (let p = 1; p <= snapshot.pageCount; p++) {
    const size = snapshot.pageSizes[p - 1] || { width: 612, height: 792 };
    const lines = groupIntoLines(snapshot.textItems, p);
    const children = [];

    if (lines.length) {
      for (const line of lines) {
        const text = line.runs.map((r) => r.str).join(" ");
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text,
                size: Math.max(14, Math.round(line.fontSize * 2)),
                font: "Helvetica",
              }),
            ],
            spacing: { after: 60, line: 276, lineRule: "auto" },
          }),
        );
        totalLines++;
      }
    } else {
      const text = snapshot.textByPage[p - 1] || "";
      for (const pl of text.split(/\r?\n/)) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: pl, size: 22, font: "Helvetica" })],
            spacing: { after: 60 },
          }),
        );
        totalLines++;
      }
    }

    if (!children.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
    }

    sections.push({
      properties: {
        page: {
          size: {
            width: Math.round(size.width * PT_TO_TWIP),
            height: Math.round(size.height * PT_TO_TWIP),
          },
          margin: {
            top: Math.round(54 * PT_TO_TWIP),
            bottom: Math.round(54 * PT_TO_TWIP),
            left: Math.round(54 * PT_TO_TWIP),
            right: Math.round(54 * PT_TO_TWIP),
          },
        },
      },
      children,
    });
  }

  const doc = new Document({
    creator: options.author || snapshot.metadata.author || "patchpdf",
    title: options.title || snapshot.metadata.title || "Exported from PDF",
    description: options.subject || snapshot.metadata.subject || "patchpdf export",
    sections: sections.length
      ? sections
      : [{ children: [new Paragraph({ children: [new TextRun({ text: "(empty)" })] })] }],
  });

  const blob = await Packer.toBlob(doc);
  const ab = await blob.arrayBuffer();
  return {
    bytes: new Uint8Array(ab),
    pages: snapshot.pageCount,
    lines: totalLines,
    mode: "layout",
    warnings,
  };
}
