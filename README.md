# patchpdf

Surgical PDF editor that runs **entirely in the browser**.

| | |
|---|---|
| **Live** | https://martialgames.net/tools/patchpdf/ |
| **Tools hub** | https://martialgames.net/tools/ |
| **Layout** | Own dark tool chrome (not Martial Games portal skin) |
| **Open source** | MIT candidate — this folder (`engine.js` + UI). Site Functions stay private. |

## What it does

1. **Line edit** — list text runs, edit fields, apply in place (cover + redraw).
2. **AI command** — OpenAI-compatible plan (optional). PDF bytes stay local; only a text snapshot goes to the model you choose.
3. **DOCX export** — layout-approximate Word export client-side.

## Architecture

```
Your browser
  pdf.js  → extractSnapshot
  plan    → your LLM key (direct for Ollama, /api/llm-proxy for cloud)
  pdf-lib → applyOperations
  docx    → export
```

There is **no server-side PDF processing** and **no product character quota** on the document. AI prompts use a soft 400k-char safety budget so provider APIs stay within reason.

## Privacy

- API keys: `sessionStorage` only (cleared when the tab session ends).
- Cloud AI: thin Cloudflare Function `POST /api/llm-proxy` forwards chat completions to allowlisted hosts with **your** Bearer key. No key storage, no PDF upload.
- Visual **cover** is not forensic redaction.

## Files

| File | Role |
|------|------|
| `index.html` | Shell |
| `app.css` | Tool chrome |
| `app.js` | UI |
| `engine.js` | Portable engine (extract / validate / apply / plan / docx) |
| `sample-invoice.pdf` | Demo |

## Open source plan

Mirror **only** this directory under MIT (like Gridsmith):

- Keep: `engine.js`, `app.js`, `app.css`, `index.html`, sample PDF, this README
- Do **not** publish: `functions/api/llm-proxy.js` (host-specific allowlist), Martial Games portal, game code

```bash
# Example: publish from a clean tree
# git clone … && copy public/tools/patchpdf/* into the OSS repo
```

Official product URL remains martialgames.net.

## Local preview

```bash
cd public && python3 -m http.server 8780 --bind 127.0.0.1
# open http://127.0.0.1:8780/tools/patchpdf/
# Note: /api/llm-proxy only works on Cloudflare Pages (or wrangler pages dev)
```

## License

Production copy: © Martial Systems LLC (site LICENSE).  
Intended OSS engine/UI license: **MIT** (same model as [gridsmith](https://github.com/ile1/gridsmith)).
