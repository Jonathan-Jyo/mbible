// mini 기능 대체(js/mini-polyfill.js) 시험 — 크롬 74 에 없는 Blob.text()·arrayBuffer() (76+)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../js/mini-polyfill.js", import.meta.url), "utf8");

// 크롬 74 처럼 text/arrayBuffer 가 없는 Blob 과, FileReader 를 흉내 낸다
function oldWorld() {
  function Blob(parts) { this._s = parts.join(""); }
  function FileReader() {}
  FileReader.prototype.readAsText = function (b) { const r = this; setTimeout(() => { r.result = b._s; r.onload(); }, 0); };
  FileReader.prototype.readAsArrayBuffer = function (b) { const r = this; setTimeout(() => { r.result = new TextEncoder().encode(b._s).buffer; r.onload(); }, 0); };
  const ctx = { Blob, FileReader, Promise, setTimeout, TextEncoder };
  ctx.window = ctx;
  return vm.createContext(ctx);
}

test("blob-text-filled-when-missing", async () => {
  const ctx = oldWorld();
  vm.runInContext(SRC, ctx);
  const b = new ctx.Blob(["가나다"]);
  assert.equal(await b.text(), "가나다");
  assert.equal(new Uint8Array(await b.arrayBuffer()).length, 9);
});

test("existing-methods-left-alone", () => {
  const ctx = oldWorld();
  const mine = function () { return "원래"; };
  ctx.Blob.prototype.text = mine;
  vm.runInContext(SRC, ctx);
  assert.equal(ctx.Blob.prototype.text, mine);
});
