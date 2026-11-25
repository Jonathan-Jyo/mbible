// mini 보정 CSS 생성기 시험 — node --test scripts/mini-cssfix.test.mjs
// 계획: docs/superpowers/plans/2026-11-26-mini-webview74.md · Task 2
import { test } from "node:test";
import assert from "node:assert/strict";
import { gapFallback } from "./mini-cssfix.mjs";

const norm = (s) => s.replace(/\s+/g, "");

test("row-flex-gap-becomes-left-margin", () => {
  const out = gapFallback(".a{display:flex;gap:8px}");
  assert.equal(norm(out), norm(".no-flex-gap .a>*+*{margin-left:8px}"));
});

test("column-flex-gap-becomes-top-margin", () => {
  const out = gapFallback(".a{display:flex;flex-direction:column;gap:6px}");
  assert.equal(norm(out), norm(".no-flex-gap .a>*+*{margin-top:6px}"));
});

test("wrapping-flex-gap-uses-right-and-bottom", () => {
  const out = gapFallback(".a{display:flex;flex-wrap:wrap;gap:6px 10px}");
  assert.equal(norm(out), norm(".no-flex-gap .a>*{margin-right:10px;margin-bottom:6px}"));
});

test("grid-gap-is-left-alone", () => {
  assert.equal(gapFallback(".g{display:grid;grid-template-columns:1fr 1fr;gap:8px}").trim(), "");
});

test("selector-list-and-media-kept", () => {
  const out = gapFallback("@media (min-width:700px){.a,.b{display:flex;gap:var(--sp)}}");
  assert.equal(norm(out), norm("@media (min-width:700px){.no-flex-gap .a>*+*,.no-flex-gap .b>*+*{margin-left:var(--sp)}}"));
});

test("flex-hint-without-display", () => {
  const out = gapFallback(".row{align-items:center;gap:4px}");
  assert.equal(norm(out), norm(".no-flex-gap .row>*+*{margin-left:4px}"));
});

test("comments-and-strings-do-not-confuse", () => {
  const out = gapFallback('/* .x{display:flex;gap:9px} */ .q::before{content:"{";} .a{display:flex;gap:2px}');
  assert.equal(norm(out), norm(".no-flex-gap .a>*+*{margin-left:2px}"));
});

test("margin-left-auto-survives-the-fallback", () => {
  const out = gapFallback(".nav{display:flex;gap:8px} .nav .set{margin-left:auto} .b{margin:0 0 0 auto} .c{margin:4px auto}");
  const n = norm(out);
  // 대체 규칙 뒤에, 같은 표시 아래에서 오른쪽 밀기를 다시 세운다
  assert.ok(n.indexOf(norm(".no-flex-gap .nav .set{margin-left:auto}")) > n.indexOf(norm(".no-flex-gap .nav>*+*{margin-left:8px}")), out);
  assert.ok(n.includes(norm(".no-flex-gap .b{margin-left:auto}")), out);
  assert.ok(n.includes(norm(".no-flex-gap .c{margin-left:auto}")), out);
});
