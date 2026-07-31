# patchpdf (library)

The main selling point of this: Most AIs just regenerate a new pdf, rather than editing it. This allows you to use your api to create a pdf which can be edited line for line, and even downloaded as a .docx. 

Edit text on an existing PDF without rebuilding the whole file.

Load a PDF, change specific lines (or let a model propose a short list of
ops), then write a new PDF that still looks like the original. Runs in the
browser with pdf-lib and pdf.js.

## License (read this)

| | |
|---|---|
| **MIT** | Source code in this repo (`engine.js`, demo UI, sample PDF) |
| **Not MIT** | Name/logo/official product branding (see [TRADEMARK.md](./TRADEMARK.md)) |

You can fork, modify, and ship the **code**. Bring your own name and icons
for anything public-facing. Do not present a fork as the official
martialgames.net product.

## Official product

Hosted build (branded UI, private site APIs):

https://martialgames.net/tools/patchpdf/

This GitHub repo is the engine plus a **generic demo**. No LLC product icons
are included on purpose.

### Mobile — paused

**Mobile / narrow viewports are not supported yet.** The hosted product shows a
grayed **Coming soon** screen under ~900px width; the tools hub card is disabled
the same way on phones. Line-level PDF editing still needs a larger screen and is
**not fully implemented** for touch layouts.

Use a desktop or laptop browser for the official tool and for this demo. A real
mobile editor is paused until that UX is designed and shipped — do not treat
phone use as supported.

## Run the demo

```bash
python3 -m http.server 8080
# open http://127.0.0.1:8080/
```

No build step. No private asset folder. The demo UI is self-contained and
uses plain CSS (no Martial Games marks).

### Building your own branded app from the engine

1. Copy `engine.js` into your project (or submodule this repo).
2. Call `extractSnapshot`, `applyOperations`, `editPdf`, etc. from your UI.
3. Supply **your own** favicon, logo, and CSS. Do not pull icons from the
   official site or from old commits of this project.
4. If you need a server-side LLM proxy, write your own. The production proxy
   on martialgames.net is not open source.

```js
import { extractSnapshot, applyOperations } from "./engine.js";

const bytes = new Uint8Array(await file.arrayBuffer());
const snap = await extractSnapshot(bytes);
// Prefer find text over id (id is optional and only used when it matches find).
const result = await applyOperations(bytes, [
  {
    op: "replace_line",
    page: 1,
    find: "Acme Corp",
    replace: "Contoso",
    fit: true,
  },
]);
// Resulting run text: "Bill To: Contoso" (label kept; not just "Contoso")
// result.bytes → save as PDF
```

### Agents / scripts (no UI)

Prefer **patch over regenerate** for fact/label fixes. Use the programmatic helpers
(`buildPatchmap`, `patchPdfAgent`, `verifyPdfText`, `applyOperations` with
`failOnSkip`). The human demo UI does **not** surface these — see
**[AGENT_API.md](./AGENT_API.md)**.

## Files

| File | Role |
|------|------|
| `engine.js` | Extract, validate, apply, agent API, optional AI plan, DOCX map |
| `AGENT_API.md` | Agent/programmatic API (not human UI) |
| `app.js` / `index.html` / `app.css` | Generic demo shell (unchanged chrome) |
| `sample-invoice.pdf` | Dummy invoice for local tests |
| `TRADEMARK.md` | What MIT does not cover |
| `LICENSE` / `NOTICE` | Legal |

## How patching works

1. Read text runs and positions from the PDF.
2. Plan a change (hand edit or model JSON).
3. Cover the old glyphs and draw the new text in the same box.
4. Save the modified PDF.

The model does not redraw the full page. It only suggests operations.
Apply always runs on the original bytes.


## Important limits (read before production use)

**Edits are visual covers, not content-stream deletes.**  
`replace_line` / `replace_text` draw a white rectangle over the old run and paint
new text on top. The original glyphs often remain in the PDF content stream.
`pdftotext`, copy/paste, search, and screen readers may still see the old value
next to the new one. The `cover` op is the same idea (and is labeled as such).
This is **not** forensic redaction and is a poor fit for sealed legal/financial
correction workflows until a true stream rewrite lands.

**Ambiguous matches fail closed.**  
If `"$500.00"` appears four times, `replace_line` is **SKIPPED** (nothing drawn)
unless you pass `id` or `itemIndex`. `replace_text` with multiple hits is skipped
unless `all: true`. Check `result.warnings` for `SKIPPED:` lines.

**Soft edit mode only (default).**  
Replacements that need a font smaller than **8pt** to fit the original box are
**SKIPPED** unless you set `force: true` (then they may draw as small as 5.5pt
with a warning). Prefer short cell values in tables.

**Mode name:** these text ops are *soft* (visual cover). A future *hard* stream
rewrite is not implemented yet.

**Watermark / rotate / metadata / delete pages** are straightforward and do not
use the cover path.


## AI planner contract

The apply engine **fail-closes** on ambiguous finds. Wire your planner so that:

- Snapshot lines are `#id [pN …] "text"` in **top-to-bottom, left-to-right** order.
- If `find` is not unique on the page, the op **must** include `id` (preferred) or
  `itemIndex` (0-based among matches in that same reading order).
- Otherwise `applyOperations` returns `SKIPPED` and draws nothing.
- To change every copy of a string, use `replace_text` with `"all": true`.

`planEdits` embeds this contract in its system prompt. Custom planners should do the same.

## AI notes

`engine.js` can call OpenAI-compatible chat APIs if you pass a key and base
URL. Local regex patterns work offline. Cloud CORS is on you in forks.

## Contributing

PRs on the engine and demo are welcome. Do not add Martial Games logos,
product wordmarks, or copy that implies official endorsement of a fork.
