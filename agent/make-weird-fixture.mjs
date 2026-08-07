#!/usr/bin/env node
/** Generate fixtures/weird-fixture.pdf — pathological layout for surgical-edit tests. */
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../fixtures");
const outPath = path.join(outDir, "weird-fixture.pdf");

const doc = await PDFDocument.create();
const helv = await doc.embedFont(StandardFonts.Helvetica);
const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
const times = await doc.embedFont(StandardFonts.TimesRoman);
const courier = await doc.embedFont(StandardFonts.Courier);
const obliq = await doc.embedFont(StandardFonts.HelveticaOblique);
const black = rgb(0, 0, 0);
const gray = rgb(0.4, 0.4, 0.4);
const red = rgb(0.8, 0, 0);

function draw(page, font, text, x, y, size = 11, color = black) {
  page.drawText(text, { x, y, size, font, color });
}

const p1 = doc.addPage([612, 792]);
draw(p1, helvB, "WEIRD FIXTURE v1", 40, 750, 20);
draw(p1, helv, "Purpose: stress layout-preserving surgical edits", 40, 728, 10, gray);
draw(p1, helv, "Subtotal: $500.00", 40, 690, 12);
draw(p1, helv, "Shipping: $12.00", 40, 670, 12);
draw(p1, helv, "Tax line: $500.00", 40, 650, 12);
draw(p1, helv, "Grand total: $500.00", 40, 630, 12);
draw(p1, helv, "ID: CAT", 40, 590, 12);
draw(p1, helv, "ID: CATALOG-ITEM-99", 40, 570, 12);
draw(p1, helv, "ID: CAT-SCAN", 40, 550, 12);
draw(p1, courier, "Pattern: a+b*c? (group) [class] {n} $end ^start", 40, 510, 9);
draw(p1, courier, "Path: C:\\Users\\sam\\file (1).pdf", 40, 490, 9);
draw(p1, courier, 'JSON-ish: {"a":1,"b":"x.y"}', 40, 470, 9);
draw(p1, times, 'He said "it\'s fine" — really.', 40, 430, 12);
draw(p1, times, "O'Reilly & Associates", 40, 410, 12);
draw(p1, helv, "TINYtext@5.5pt", 40, 370, 5.5);
draw(p1, helvB, "HUGE", 40, 320, 36);
const long = "LONG:" + "word-".repeat(40) + "END";
draw(p1, helv, long.slice(0, 95), 40, 280, 8);
draw(p1, helv, long.slice(95, 190), 40, 268, 8);
draw(p1, helv, "LONG_MARKER_ALPHA", 40, 250, 10);
draw(p1, helv, "padded:   spaces   here", 40, 210, 11);
draw(p1, helv, "tabs? not really tabs", 40, 190, 11);
draw(p1, helv, "trailing space end ", 40, 170, 11);
draw(p1, helv, "UNDER", 40, 130, 14);
draw(p1, helv, "OVER", 55, 133, 14, red);

const p2 = doc.addPage([612, 792]);
draw(p2, helvB, "PAGE TWO — more weird", 40, 750, 16);
draw(p2, helv, "Grand total: $500.00", 40, 710, 12);
draw(p2, helv, "Only on page two: P2_ONLY_TOKEN", 40, 690, 12);
draw(p2, helv, "FontHelv", 40, 650, 12);
draw(p2, times, "FontTimes", 120, 650, 12);
draw(p2, courier, "FontCourier", 220, 650, 12);
draw(p2, obliq, "FontOblique", 340, 650, 12);
draw(p2, times, "Cafe resume naive facade", 40, 610, 12);
draw(p2, times, "Café résumé naïve façade", 40, 590, 12);
draw(p2, helv, "Rate: 12.5% (was 0.0%)", 40, 550, 12);
draw(p2, helv, "Rate: 0.0% baseline only", 40, 530, 12);
p2.drawText("ROTATED_45", { x: 400, y: 500, size: 14, font: helvB, color: black, rotate: degrees(45) });
p2.drawText("SIDEWAYS", { x: 520, y: 200, size: 12, font: helv, color: black, rotate: degrees(90) });
const headers = ["SKU", "Name", "Qty", "Price"];
const rows = [
  ["A-1", "Widget", "2", "$9.99"],
  ["A-1", "Gadget", "1", "$9.99"],
  ["B-2", "Thing (v2)", "10", "$0.99"],
  ["C-3", "x.y.z", "0", "$0.00"],
];
let y = 450;
draw(p2, helvB, headers.join("  |  "), 40, y, 10);
y -= 18;
for (const r of rows) {
  draw(p2, courier, r.join("  |  "), 40, y, 10);
  y -= 16;
}

const p3 = doc.addPage([612, 792]);
draw(p3, helvB, "PAGE THREE — traps", 40, 750, 16);
draw(p3, helv, "case: Hello World", 40, 700, 12);
draw(p3, helv, "case: hello world", 40, 680, 12);
draw(p3, helv, "case: HELLO WORLD", 40, 660, 12);
draw(p3, helv, "nb: foo bar", 40, 620, 12);
draw(p3, helv, "nb: foo  bar", 40, 600, 12);
draw(p3, helv, "nb: foo bar ", 40, 580, 12);
draw(p3, helv, "version 1.0.0", 40, 540, 12);
draw(p3, helv, "version 1.0", 40, 520, 12);
draw(p3, helv, "1.0.0-rc.1", 40, 500, 12);
draw(p3, helv, "See note (1)", 40, 460, 12);
draw(p3, helv, "See note (2)", 40, 440, 12);
draw(p3, helv, "See note (1) again", 40, 420, 12);
draw(p3, helvB, "SENTINEL_UNIQUE_ZZ9", 40, 380, 14);
draw(p3, helv, "$1", 40, 340, 8);
draw(p3, helv, "ok", 40, 320, 8);
for (let i = 0; i < 8; i++) draw(p3, courier, "X", 40 + i * 10, 280 - i * 10, 12);

doc.setTitle("Weird Surgical Edit Fixture");
doc.setAuthor("patchpdf-agent-test");
doc.setSubject("Edge cases for layout-preserving patch");
doc.setKeywords(["weird", "duplicate", "surgical"]);
doc.setProducer("patchpdf agent weird fixture");
doc.setCreator("agent/make-weird-fixture.mjs");

fs.mkdirSync(outDir, { recursive: true });
const bytes = await doc.save();
fs.writeFileSync(outPath, bytes);
console.log("wrote", outPath, bytes.length, "bytes");
