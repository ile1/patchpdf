# Weird fixture — surgical edit results

**Date:** 2026-08-07  
**Branch:** `agent-surgical-edit`  
**PDF:** `fixtures/weird-fixture.pdf` (3 pages, ~100 extracted text runs)  
**CLI:** `agent/cli.mjs` → `patchPdfAgent` (failOnSkip default)

## What’s in the fixture

| Category | Examples on the PDF |
|----------|---------------------|
| Duplicate currency | `$500.00` ×3 on p1 + ×1 on p2 (4 extract hits) |
| Substring traps | `ID: CAT` / `CATALOG-ITEM-99` / `CAT-SCAN` |
| Regex-ish literals | `a+b*c?`, `[class]`, `{n}`, `$end ^start` |
| Paths / JSON | `C:\Users\sam\file`, `{"a":1,"b":"x.y"}` |
| Quotes | `O'Reilly & Associates`, `"it's fine"` + em dash |
| Tiny / huge fonts | 5.5pt `TINYtext@5.5pt`, 36pt `HUGE` |
| Long lines | Word-repeated line (pdf.js split into 2 runs) |
| Whitespace | Multi-space “padded” line; trailing space |
| Overlap | `UNDER` / `OVER` stacked |
| Multi-page twin | `Grand total: $500.00` on p1 and p2 |
| Fonts | Helvetica / Times / Courier / Oblique |
| Accents (WinAnsi) | `Café résumé naïve façade` |
| Rotation | `ROTATED_45` (45°), `SIDEWAYS` (90°) |
| Table-like | SKU/Name/Qty/Price; duplicate `A-1` and `$9.99` |
| Case twins | Hello World / hello world / HELLO WORLD |
| Version substrings | `1.0.0` vs `1.0` vs `1.0.0-rc.1` |
| Notes | `See note (1)` vs `(2)` vs `(1) again` |
| Tiny cell | `$1` at 8pt |
| Repeated glyphs | Diagonal `X` ×8 |

## Extract / map quirks (before any patch)

These affect ops design more than apply itself:

1. **Courier long lines fragment** — one `drawText` for Pattern/Path/JSON becomes several ids (`Pattern:`, `a+b*c?`, …).
2. **Multi-space collapses** — `padded:   spaces   here` → items `padded:`, `spaces`, `here` (extra spaces gone).
3. **Trailing space stripped** — `trailing space end ` → `trailing space end`.
4. **Double-space variants look identical** — three `nb: foo bar` lines (different visual spacing) all extract as `'nb: foo bar'`.
5. **Table becomes many runs** — each cell and `|` is its own id; good for id targeting, bad for “whole row” replace.
6. **Accents work** with StandardFonts when glyphs exist (café line present as id 42).

## Scenario results (32 scripted)

**29/32 matched expectation** on first pass.  
**3 soft-fit refusals** succeeded with `force: true`.

### Succeeded (layout-preserving apply + verify)

| # | Case | Notes |
|---|------|--------|
| 01 | Unique `SENTINEL_UNIQUE_ZZ9` | Clean happy path |
| 02 | `P2_ONLY_TOKEN` page 2 | Multi-page OK |
| 04–05 | `Grand total: $500.00` p1 vs p2 by **id** | Same string, different pages/ids |
| 06 | `ID: CAT` by id | Did not need to touch CATALOG |
| 09 | JSON fragment `{"a":1,…}` | Special chars OK when id+find match extract |
| 10 | Windows path fragment | Backslashes OK |
| 11 | `O'Reilly & Associates` | Apostrophe OK |
| 14 | `HUGE` → `BIG` | Large font OK |
| 15 | Accented French line → ASCII | Encode/replace OK |
| 16–17 | Rotated + sideways text | **Surprising win** — id/find still worked |
| 19 | Table `$9.99` by id (one cell) | Disambiguated |
| 20 | Case: only `Hello World` line | Case-sensitive |
| 21 | `version 1.0` by id | Substring-safe via full line find |
| 22 | `See note (1)` not “again” | Parentheses OK |
| 24 | `$1` → `$9` with **force** | Soft-fit otherwise |
| 25 | `OVER` → `TOP` | Overlap pair |
| 28 | `LONG_MARKER_ALPHA` | Marker line OK |
| 29 | `0.0% baseline only` by full line | Avoided other `0.0%` |
| 30 | `padded:` chunk | After space collapse |
| 31 | Quotes/em-dash line | OK |
| 32 | `all:true` on `$500.00` | All 4 hits including p2 |

### Fail-closed as designed (good)

| # | Case | Behavior |
|---|------|----------|
| 03 | `replace_text "$500.00"` no id | **4 matches → SKIPPED** |
| 07 | `replace_text "CAT"` | **3 matches → SKIPPED** |
| 12 | Tiny line + long replacement | Soft-fit **SKIPPED** (&lt;8pt) |
| 18 | Table `$9.99` no id | **2 matches → SKIPPED** |
| 23 | `$1` → `$999999` | Soft-fit **SKIPPED** |
| 26 | `replace_text "X"` no all | **13 matches → SKIPPED** (includes X inside other words!) |

Note on 26: `"X"` matched not only diagonal X’s but also characters inside other strings (e.g. FIXTURE, Tax, JSON, TINY…). Fail-closed here prevents silent corruption.

### Soft-fit surprises (need force or shorter text)

| # | Case | First try | With `force:true` |
|---|------|-----------|-------------------|
| 08 | `a+b*c?` → `SAFE_PAT` / `SAFE` | SKIPPED (~6.6pt) | **OK** (shorter SAFE) |
| 13 | Tiny → `TINY_OK` | SKIPPED (box already 5.5pt) | **OK** + warning drew at 5.5pt |
| 27 | `all:true` X→Y | SKIPPED on hit #22 (tiny box) | **OK** with force (13 hits) |

**Rule of thumb:** any run whose **source** fontSize is already &lt; 8pt, or whose replacement needs &lt; 8pt to fit, needs **`force: true`** or a shorter string.

## Scorecard vs goals

| Goal | Result |
|------|--------|
| Change unique weird tokens | **Strong** |
| Fail closed on duplicates | **Strong** |
| id disambiguation across pages/tables | **Strong** |
| Regex-looking / JSON / path text | **OK** if find matches **extracted** fragment |
| Rotated text | **OK** in this fixture |
| Tiny fonts | **Soft-fit blocks by default** (safety); force works |
| Multi-space / trailing space fidelity | **Weak at extract** — cannot target visual-only spacing |
| Whole-row table edit as one string | **Weak** — map splits cells |
| `replace_text` single letter | **Dangerous** without id; fail-closed if multi |

## Agent guidance (from this run)

1. Always **`map` first**; trust **ids + exact extracted `find`**, not the original draw string if they differ.  
2. Never bare `replace_text` on short/common tokens (`$500.00`, `CAT`, `X`).  
3. Prefer **full line** `find` for version/percent traps.  
4. For &lt;8pt cells: shorten replacement or set **`force: true`**.  
5. Expect **fragmented** lines for monospaced long text.  
6. After apply, **`verify --contains` on NEW text** only (cover-paint).

## Artifacts

- Fixture: `fixtures/weird-fixture.pdf`  
- Map: `agent/.cache/weird/map.json`  
- Per-scenario ops/pdfs: `agent/.cache/weird/*.ops.json`, `*.pdf`  
- Machine summary: `agent/.cache/weird/results.json`
