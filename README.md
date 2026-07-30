# patchpdf (library)

Edit text on an existing PDF without rebuilding the whole file.

You load a PDF, change specific lines (or let a model propose a short list of ops), then write a new PDF that still looks like the original. Work runs in the browser with [pdf-lib](https://pdf-lib.js.org/) and [pdf.js](https://mozilla.github.io/pdf.js/).

## License

**MIT** for the software in this repository (`engine.js`, demo UI, sample PDF).

Name, logo, and official product branding are **not** licensed here. See [BRAND.md](./BRAND.md).

## Official product

Hosted build with full product UI and branding:

**https://martialgames.net/tools/patchpdf/**

This GitHub repo is the open source **engine and a minimal demo**. It is not the Martial Games site and does not include production API proxies.

## Quick start

```bash
# any static server
python3 -m http.server 8080
# open http://127.0.0.1:8080/
```

Or import the engine in your own page:

```js
import { extractSnapshot, applyOperations, editPdf } from "./engine.js";

const bytes = new Uint8Array(await file.arrayBuffer());
const snap = await extractSnapshot(bytes);
// snap.textItems → line editor
const result = await applyOperations(bytes, [
  { op: "replace_line", id: 0, page: 1, find: "Acme Corp", replace: "Contoso", fit: true },
]);
// result.bytes → download as PDF
```

## Layout of the repo

| File | What it is |
|------|------------|
| `engine.js` | Extract, validate ops, apply patches, optional AI plan, DOCX map |
| `app.js` / `index.html` / `app.css` | Small demo UI (no product branding assets) |
| `sample-invoice.pdf` | Dummy invoice for local tries |

CDN imports for pdf-lib, pdf.js, and docx are loaded from jsDelivr inside `engine.js`.

## How patching works

1. Read text runs and positions from the PDF.
2. Plan a change (hand edit or model JSON).
3. Cover the old glyphs and draw the new text in roughly the same box.
4. Save the modified PDF.

The model never redraws the full page. It only suggests operations. Apply always runs on the original bytes.

Word export is a geometry map of those same runs into `.docx`. Useful for drafting. The patched PDF is still the thing you keep when layout matters.

## AI profiles

`engine.js` can call OpenAI-compatible chat endpoints if you pass a key and base URL. Local regex patterns work offline. Cloud CORS is your problem in forks; the production site uses a private proxy that is not in this repo.

## Contributing

PRs against the engine and demo are welcome. Please do not add Martial Games logos, product wordmarks, or copy that implies official endorsement of a fork.
