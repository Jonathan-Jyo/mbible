// mini 변환기 시험 — node --test scripts/mini-transpile.test.mjs (npm run test:mini)
// 계획: docs/superpowers/plans/2026-11-26-mini-webview74.md · Task 1
import { test } from "node:test";
import assert from "node:assert/strict";
import { lowerJs, lowerHtml, isClean } from "./mini-transpile.mjs";

test("lowers-optional-chaining", async () => {
  const out = await lowerJs("var a={};var r=a?.b??1;", "t.js");
  assert.ok(!out.includes("?."), out);
  assert.ok(!out.includes("??"), out);
});

test("transpiled-behaves-the-same", async () => {
  const a = await lowerJs("var a={};var r=a?.b??1;", "t.js");
  assert.equal(new Function(a + ";return r")(), 1);
  const b = await lowerJs("var a={b:{c:5}};var r=a?.b?.c ?? 0;var x=null;x ??= 7;", "t.js");
  assert.deepEqual(new Function(b + ";return [r,x]")(), [5, 7]);
});

test("inline-script-with-closing-tag-string", async () => {
  const html = '<script>var s="<\\/script>";var o={};var v=o?.k;</script><p>끝</p>';
  const out = await lowerHtml(html, "t.html");
  assert.ok(out.includes("<p>끝</p>"), out);
  assert.ok(!out.includes("?."), out);
});

test("leaves-src-scripts-alone", async () => {
  const html = '<script src="a.js"></script><script type="application/json">{"a?.b":1}</script>';
  assert.equal(await lowerHtml(html, "t.html"), html);
});

test("isClean", async () => {
  assert.equal(await isClean("var a=1;"), true);
  assert.equal(await isClean("var a={};a?.b;"), false);
});

test("unlowerable-syntax-fails", async () => {
  await assert.rejects(() => lowerJs("await 1;", "x.js"), /x\.js/);
});
