#!/usr/bin/env node
// ============================================================================
// mini-transpile — 소형폰 판(mini)의 스크립트를 크롬 74 문법으로 바꾼다 (v4.33.2)
// ----------------------------------------------------------------------------
// S45 Pro(안드로이드 10)의 제조사 WebView 74 는 ?. · ?? · ??= ||= &&= 를 모른다 — 그 문법이 든 스크립트 파일을
// 통째로 버려 화면이 「불러오는 중」에서 멈췄다(진단 화면 결과, 2026-11-26).
// 원본은 그대로 두고, build-mini.sh 가 만든 www-mini 안에서만 esbuild 로 문법을 낮춘다.
//   · 번들하지 않는다 — 파일마다 문법만 바꾸므로 전역 이름·스크립트 차례가 그대로다
//   · js/*.js · 맨 위 *.js(sw.js) · lib/sqljs/sql-wasm.js · 각 *.html 안의 일반 <script> 글
//   · 다 바꾼 뒤 「더 낮출 것이 남았나」를 다시 검사해, 남았으면 실패한다(빌드가 멈춘다)
//
//   node scripts/mini-transpile.mjs <www-mini 폴더>
// 설계: docs/superpowers/specs/2026-11-26-mini-webview74-design.md
// ============================================================================
import { transform } from "esbuild";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = "chrome74";
const OPTS = { loader: "js", charset: "utf8", legalComments: "inline" };

/** 스크립트 글 하나를 크롬 74 문법으로 — 낮출 수 없는 문법이면 name 을 담아 실패 */
export async function lowerJs(code, name) {
  try {
    return (await transform(code, { ...OPTS, target: TARGET, sourcefile: name })).code;
  } catch (e) {
    throw new Error(`${name}: 크롬 74 문법으로 바꾸지 못했습니다 — ${e.message}`);
  }
}

// 내용이 있는 일반 스크립트만 — src 로 부르는 것, JSON·템플릿 같은 다른 type 은 그대로 둔다
const SCRIPT_RE = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const isPlainJs = (attrs) => {
  const a = attrs || "";
  if (/\ssrc\s*=/i.test(a)) return false;
  const m = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(a);
  return !m || /^(text\/javascript|application\/javascript|module)$/i.test(m[1]);
};

/** HTML 안의 일반 <script> 글을 크롬 74 문법으로 바꿔 끼운다 */
export async function lowerHtml(html, name) {
  const parts = [];
  let last = 0, m, k = 0;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html))) {
    const [whole, attrs, body] = m;
    parts.push(html.slice(last, m.index));
    if (isPlainJs(attrs) && body.trim()) {
      const out = await lowerJs(body, `${name} <script ${++k}>`);
      // esbuild 가 "<\/script>" 를 "</script>" 로 되돌려 쓰면 HTML 이 거기서 끊긴다 — 다시 막는다
      parts.push(`<script${attrs || ""}>\n${out.replace(/<\/script/gi, "<\\/script")}</script>`);
    } else parts.push(whole);
    last = m.index + whole.length;
  }
  parts.push(html.slice(last));
  return parts.join("");
}

/** 더 낮출 것이 없는가 — 그대로 다시 찍은 것과 크롬 74 로 낮춘 것이 같으면 깨끗하다 */
export async function isClean(code) {
  const same = (await transform(code, { ...OPTS, target: "esnext" })).code;
  const low = (await transform(code, { ...OPTS, target: TARGET })).code;
  return same === low;
}

// HTML 의 일반 스크립트 글들(검사용)
function scriptsOf(html) {
  const out = [];
  let m;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html))) if (isPlainJs(m[1]) && m[2].trim()) out.push(m[2]);
  return out;
}

async function targets(dir) {
  const list = [];
  const js = join(dir, "js");
  if (existsSync(js)) for (const f of (await readdir(js)).sort()) if (f.endsWith(".js")) list.push(join(js, f));
  for (const f of (await readdir(dir)).sort()) if (f.endsWith(".js")) list.push(join(dir, f));   // 맨 위 sw.js(화면 밖 일꾼)
  const sql = join(dir, "lib", "sqljs", "sql-wasm.js");
  if (existsSync(sql)) list.push(sql);
  for (const f of (await readdir(dir)).sort()) if (f.endsWith(".html")) list.push(join(dir, f));
  return list;
}

/** 폴더 안의 대상을 모두 바꾸고, 다시 검사한다 — 남은 것이 있으면 실패 */
export async function transpileDir(dir) {
  const files = await targets(dir);
  let changed = 0;
  for (const p of files) {
    const src = await readFile(p, "utf8");
    const out = p.endsWith(".html") ? await lowerHtml(src, basename(p)) : await lowerJs(src, basename(p));
    if (out !== src) { await writeFile(p, out); changed++; }
  }
  const dirty = [];
  for (const p of files) {
    const src = await readFile(p, "utf8");
    const codes = p.endsWith(".html") ? scriptsOf(src) : [src];
    for (const c of codes) if (!(await isClean(c))) { dirty.push(basename(p)); break; }
  }
  if (dirty.length) throw new Error(`크롬 74 가 모르는 문법이 남았습니다: ${dirty.join(", ")}`);
  return { files: files.length, changed };
}

// 명령줄
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) { console.error("쓰는 법: node scripts/mini-transpile.mjs <www-mini 폴더>"); process.exit(1); }
  transpileDir(dir)
    .then(r => console.log(`크롬 74 문법으로 — 파일 ${r.files}개 · 바뀜 ${r.changed}개 · 검사 통과`))
    .catch(e => { console.error("✗ " + e.message); process.exit(1); });
}
