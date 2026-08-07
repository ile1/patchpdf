# patchpdf agent (surgical edit only)

**Scope:** layout-preserving text patch on an *existing* PDF for coding agents.  
**Not in scope:** demo UI, forms, OCR, merge/split, full document regeneration, marketplace packaging.

Grok’s bundled `pdf` skill is strong at **read / create / forms**. Agents still tend to **regenerate** when they only need a fact/label fix. This CLI is the scalpel for that case.

## Setup

```bash
cd agent
npm install
```

## Commands

```bash
# 1) Stable line ids (reuse across agent turns when still valid)
node cli.mjs map ../sample-invoice.pdf -o /tmp/doc.patchmap.json

# 2) Apply ops (fail-closed by default)
node cli.mjs apply ../sample-invoice.pdf ops.json -o /tmp/out.pdf \
  --verify-contains "NEW TEXT"

# 3) Verify extract
node cli.mjs verify /tmp/out.pdf --contains "NEW TEXT"

# Smoke (map + one replace_line + verify on sample invoice)
node cli.mjs smoke
```

### ops.json

```json
{
  "operations": [
    {
      "op": "replace_line",
      "page": 1,
      "id": 12,
      "find": "Acme Corp",
      "replace": "Contoso",
      "fit": true
    }
  ],
  "verify": { "contains": ["Contoso"] }
}
```

Always prefer **`id` + `find`**. Ambiguous finds are **SKIPPED** (nothing drawn) unless you disambiguate.

## Agent loop (prefer over regen)

1. `map` → save patchmap  
2. Plan ≤ 8 `replace_line` ops with `id` + unique `find`  
3. `apply` with fail-on-skip (default) + `--verify-contains` for **new** strings  
4. If skip/fit refuse → shorten text or fix the generator and regen once  

## Honesty

- Edits are **visual cover + redraw**, not content-stream delete. Old glyphs may still extract.  
- Assert `contains` on the **new** text; do not require forensic purity unless you regen.  
- Patch is for **layout fidelity**, not always wall-clock speed. See root `AGENT_API.md`.

## Engine loading

`load-engine.mjs` rewrites CDN imports in `../engine.js` to npm packages and caches under `agent/.cache/`. The browser demo still uses `engine.js` as-is.
