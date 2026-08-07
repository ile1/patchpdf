#!/usr/bin/env node
/**
 * patchpdf-agent — layout-preserving surgical PDF edits for coding agents.
 *
 * Scope (this CLI only):
 *   map     → buildPatchmap (stable line ids)
 *   apply   → patchPdfAgent / applyOperations (fail-closed defaults)
 *   verify  → verifyPdfText
 *   smoke   → map+apply+verify on sample invoice
 *
 * Not in scope: demo UI, forms, OCR, full regen, marketplace packaging.
 *
 * Prefer this over regenerating a PDF when you need original layout/fonts
 * and only fact/label changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./load-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function usage(code = 0) {
  const text = `Usage:
  patchpdf-agent map <in.pdf> [-o map.json]
  patchpdf-agent apply <in.pdf> <ops.json> -o <out.pdf> [--no-fail-on-skip] [--verify-contains s ...]
  patchpdf-agent verify <in.pdf> --contains s [--contains s2] [--not-contains s] [--strict-extract]
  patchpdf-agent smoke

ops.json is either:
  { "operations": [ ... ], "verify": { "contains": ["..."] } }
  or a bare array of operations.

Agent defaults on apply: failOnSkip=true, maxOps=32.
Cover-paint caveat: old glyphs may still extract; prefer --verify-contains on NEW text.
`;
  process.stdout.write(text);
  process.exit(code);
}

function readPdf(p) {
  return new Uint8Array(fs.readFileSync(p));
}

function writePdf(p, bytes) {
  fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  fs.writeFileSync(p, Buffer.from(bytes));
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") args.flags.help = true;
    else if (a === "-o" || a === "--out") args.flags.out = argv[++i];
    else if (a === "--no-fail-on-skip") args.flags.noFailOnSkip = true;
    else if (a === "--strict-extract") args.flags.strictExtract = true;
    else if (a === "--contains") {
      args.flags.contains = args.flags.contains || [];
      args.flags.contains.push(argv[++i]);
    } else if (a === "--not-contains") {
      args.flags.notContains = args.flags.notContains || [];
      args.flags.notContains.push(argv[++i]);
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown flag: ${a}`);
    } else args._.push(a);
  }
  return args;
}

async function cmdMap(engine, args) {
  const inPath = args._[1];
  if (!inPath) usage(1);
  const map = await engine.buildPatchmap(readPdf(inPath));
  const out = args.flags.out || "-";
  const json = JSON.stringify(map, null, 2);
  if (out === "-") process.stdout.write(json + "\n");
  else {
    fs.writeFileSync(out, json);
    process.stderr.write(`wrote ${out} (${map.nLines} lines, ${map.pageCount} pages)\n`);
  }
}

async function cmdApply(engine, args) {
  const inPath = args._[1];
  const opsPath = args._[2];
  const outPath = args.flags.out;
  if (!inPath || !opsPath || !outPath) usage(1);

  const raw = JSON.parse(fs.readFileSync(opsPath, "utf8"));
  let operations;
  let verify = null;
  if (Array.isArray(raw)) operations = raw;
  else if (raw && Array.isArray(raw.operations)) {
    operations = raw.operations;
    if (raw.verify) verify = raw.verify;
  } else throw new Error("ops.json must be an array or { operations: [] }");

  if (args.flags.contains?.length) {
    verify = verify || {};
    verify.contains = [...(verify.contains || []), ...args.flags.contains];
  }

  const result = await engine.patchPdfAgent(readPdf(inPath), {
    operations,
    failOnSkip: !args.flags.noFailOnSkip,
    verify: verify || undefined,
  });

  writePdf(outPath, result.bytes);
  const summary = {
    out: outPath,
    applied: result.applied,
    skipped: result.skipped,
    warnings: result.warnings,
    verify: result.verify
      ? {
          ok: result.verify.ok,
          missing: result.verify.missing,
          stillPresent: result.verify.stillPresent,
          warnings: result.verify.warnings,
        }
      : null,
  };
  process.stderr.write(JSON.stringify(summary, null, 2) + "\n");
}

async function cmdVerify(engine, args) {
  const inPath = args._[1];
  if (!inPath) usage(1);
  const spec = {
    contains: args.flags.contains || [],
    notContains: args.flags.notContains || [],
    strictExtract: !!args.flags.strictExtract,
  };
  const result = await engine.verifyPdfText(readPdf(inPath), spec);
  process.stdout.write(
    JSON.stringify(
      {
        ok: result.ok,
        missing: result.missing,
        stillPresent: result.stillPresent,
        warnings: result.warnings,
        pageCount: result.pageCount,
      },
      null,
      2,
    ) + "\n",
  );
  if (!result.ok) process.exit(2);
}

async function cmdSmoke(engine) {
  const sample = path.join(ROOT, "sample-invoice.pdf");
  if (!fs.existsSync(sample)) {
    throw new Error(`missing ${sample}`);
  }
  const bytes = readPdf(sample);
  const map = await engine.buildPatchmap(bytes);
  if (!map.nLines) throw new Error("smoke: empty patchmap");

  // Prefer a unique-ish line from the sample; fall back to first non-empty.
  const line =
    map.lines.find((l) => /acme|invoice|total|bill/i.test(l.str)) || map.lines[0];
  if (!line) throw new Error("smoke: no lines");

  const marker = `PATCHPDF_AGENT_${Date.now().toString(36).toUpperCase()}`;
  // Short replace to avoid soft-fit skip on tiny cells.
  const replace =
    line.str.length <= 12 ? marker.slice(0, Math.max(4, line.str.length)) : `${line.str.slice(0, 8)}_${marker.slice(-4)}`;

  const outPath = path.join(__dirname, ".cache", "smoke-out.pdf");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let result;
  try {
    result = await engine.patchPdfAgent(bytes, {
      operations: [
        {
          op: "replace_line",
          page: line.page,
          id: line.id,
          find: line.str,
          replace,
          fit: true,
        },
      ],
      failOnSkip: true,
      requireApplied: 1,
      verify: { contains: [replace] },
    });
  } catch (err) {
    // If soft-fit refused, try force for smoke only.
    if (String(err.message || err).includes("SKIPPED") || String(err.message || err).includes("fit")) {
      result = await engine.patchPdfAgent(bytes, {
        operations: [
          {
            op: "replace_line",
            page: line.page,
            id: line.id,
            find: line.str,
            replace: replace.slice(0, 6),
            fit: true,
            force: true,
          },
        ],
        failOnSkip: true,
        requireApplied: 1,
        verify: { contains: [replace.slice(0, 6)] },
      });
    } else throw err;
  }

  writePdf(outPath, result.bytes);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        sample,
        out: outPath,
        lineId: line.id,
        page: line.page,
        find: line.str,
        applied: result.applied,
        mode: "layout-preserving-surgical-edit",
      },
      null,
      2,
    ) + "\n",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help || args._.length === 0) usage(args.flags.help ? 0 : 1);

  const cmd = args._[0];
  const engine = await loadEngine();

  if (cmd === "map") await cmdMap(engine, args);
  else if (cmd === "apply") await cmdApply(engine, args);
  else if (cmd === "verify") await cmdVerify(engine, args);
  else if (cmd === "smoke") await cmdSmoke(engine);
  else {
    process.stderr.write(`Unknown command: ${cmd}\n`);
    usage(1);
  }
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  if (err && err.patchpdf) {
    process.stderr.write(
      "patchpdf diagnostics: " +
        JSON.stringify(
          {
            applied: err.patchpdf.applied,
            skipped: err.patchpdf.skipped,
            warnings: err.patchpdf.warnings,
            verify: err.patchpdf.verify
              ? {
                  missing: err.patchpdf.verify.missing,
                  stillPresent: err.patchpdf.verify.stillPresent,
                }
              : null,
          },
          null,
          2,
        ) +
        "\n",
    );
  }
  process.exit(1);
});
