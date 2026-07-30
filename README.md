# patchpdf

**Keep the PDF. Change the words.**

| | |
|---|---|
| **Live** | [martialgames.net/tools/patchpdf](https://martialgames.net/tools/patchpdf/) |
| **Hub** | [martialgames.net/tools](https://martialgames.net/tools/) |
| **License** | MIT (this folder) |

## Why it exists

Ask a model to “edit this invoice” and it will cheerfully rebuild the page.
Fonts drift. Columns slide. Legal paper stops looking like legal paper.

patchpdf does the unfashionable thing: it **patches the file you already have**.

1. Read the PDF’s text runs (positions, sizes).
2. Change only what you asked for — by hand, or with a short AI **plan**.
3. Cover the old glyphs, draw the new ones in the same box.
4. Save **that** PDF.

AI is optional. When you use it, the model never paints a new document.
It only proposes operations. Apply still runs on the original bytes, in your browser.

## What it is not

- Not a full typesetter  
- Not forensic redaction (visual cover only)  
- Not “AI rewrote my contract in Word and hoped the layout survived”

**Word export** maps measured geometry into an editable `.docx` (spacing, indents,
labels, two-column baselines). Same words as the PDF. Handy for drafting —
the patched **PDF** is still the source of truth.

## Files

| | |
|---|---|
| `engine.js` | extract · validate · apply · plan · docx map |
| `app.js` / `index.html` / `app.css` | UI |
| `favicon.svg` / `mark.svg` / `icon.jpg` | mark |
| `sample-invoice.pdf` | demo |

## Run locally

```bash
cd public && python3 -m http.server 8780 --bind 127.0.0.1
# http://127.0.0.1:8780/tools/patchpdf/
```

Cloud AI on production uses `POST /api/llm-proxy` (allowlisted hosts, your key).
That function is **not** part of this MIT mirror.

## Official vs mirror

Production lives on **martialgames.net**.  
This repo is the editor + engine so others can fork, audit, and embed.
