# patchpdf — Agent / programmatic API

**Audience:** coding agents and scripts that edit PDFs surgically.  
**Not for:** the human demo UI (unchanged look and flow).

The product goal is **faster and safer than regenerating** a typeset PDF when you only need fact/label fixes: keep layout, fonts, and pagination; change words by `id`.

Official engine (MIT): this repo’s `engine.js`.  
Hosted product UI on martialgames.net loads the same engine but **does not expose** these helpers in the browser chrome.

---

## Why this exists

Regenerating a research PDF re-runs the full layout engine (fonts, wrapping, page breaks).  
Agents should:

1. **`buildPatchmap`** once (stable line `id`s)  
2. **`patchPdfAgent`** / **`applyOperations(..., { failOnSkip: true })`** for small ops  
3. **`verifyPdfText`** for machine checks  

Only **regen** when the *generator program* is wrong (logic/schema), not for copyfixes.

---

## Imports

```js
import {
  extractSnapshot,
  buildPatchmap,
  applyOperations,
  patchPdfAgent,
  verifyPdfText,
  validateOperations,
} from "./engine.js";
```

Browser demo still uses only `extractSnapshot` + `applyOperations(bytes, ops)` with **no** third argument.

---

## `buildPatchmap(pdfBytes, options?)`

Returns a JSON-serializable map of every text run:

| Field | Meaning |
|-------|---------|
| `lines[].id` | Stable id for this extract (use with `replace_line`) |
| `lines[].page` | 1-based page |
| `lines[].str` | Run text |
| `lines[].x/y/width/height/fontSize` | Box metrics |

```js
const map = await buildPatchmap(pdfBytes);
// write map next to the PDF as doc.patchmap.json for the next agent turn
```

Prefer **`id` + `find`** on `replace_line` so multi-match cannot hit the wrong cell.

---

## `applyOperations(pdfBytes, operations, options?)`

Third argument is **agent-only** (UI omits it).

| Option | Default | Effect |
|--------|---------|--------|
| `failOnSkip` | `false` | If `true`, **throw** when any op is SKIPPED / refused |
| `maxOps` | `200` | Hard cap on op list length |
| `requireApplied` | — | Require at least N successful applies |

Return value now includes **`skipped: string[]`** in addition to `applied` and `warnings`.

```js
const { bytes, applied, skipped, warnings } = await applyOperations(
  pdfBytes,
  ops,
  { failOnSkip: true, maxOps: 16, requireApplied: ops.length },
);
```

---

## `patchPdfAgent(pdfBytes, request)` — one-shot

Agent defaults: **`failOnSkip: true`**, **`maxOps: 32`**.

```js
const out = await patchPdfAgent(pdfBytes, {
  operations: [
    {
      op: "replace_line",
      page: 2,
      id: 172,
      find: "0.0%",
      replace: "1.1%",
      fit: true,
    },
  ],
  failOnSkip: true,
  maxOps: 8,
  requireApplied: 1,
  verify: {
    contains: ["1.1%"],
    // notContains is soft unless strictExtract — cover-paint leaves old glyphs
    notContains: ["0.0%"],
    strictExtract: false,
  },
});
// out.bytes → write PDF
```

Throws on skip/verify failure with `error.patchpdf` diagnostics.

---

## `verifyPdfText(pdfBytes, spec)`

| Spec | Meaning |
|------|---------|
| `contains[]` | Must appear in extracted text |
| `notContains[]` | Flagged if still present |
| `strictExtract` | If `true`, `notContains` hits fail `ok` |

**Important:** visual cover-paint edits often leave **old strings extractable**.  
For “looks right,” assert `contains` on the new text. For forensic extract purity, regenerate or wait for stream rewrite.

---

## Recommended agent loop (faster than regen)

```
1. extractSnapshot / buildPatchmap  → save patchmap.json
2. Plan ≤ 8 replace_line ops using id + unique find
3. patchPdfAgent({ failOnSkip: true, verify: { contains: [...] } })
4. If throw (skip / fit refuse) → shorten replacement or fix generator + regen once
```

**Do not** use the human UI for batch agent work.  
**Do not** change product CSS/HTML for agent features.

---

## Human UI contract

- `app.js` continues to call `applyOperations(bytes, ops)` only.  
- No new buttons, panels, or chrome.  
- Hosted martialgames.net look stays the same.

---

## Limits (unchanged product truth)

- Edits are **visual cover + redraw**, not content-stream delete.  
- Ambiguous matches **fail closed** without `id` / `itemIndex` / `all:true`.  
- Soft fit refuses below ~8pt unless `force: true`.
