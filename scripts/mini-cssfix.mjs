#!/usr/bin/env node
// ============================================================================
// mini-cssfix — 소형폰 판(mini)의 「칸 사이 띄우기」 대체 CSS 를 만든다 (v4.33.2)
// ----------------------------------------------------------------------------
// WebView 74 는 flex 의 gap(84 판부터)을 모른다 → 단추·칸이 서로 붙는다. 손으로 옮기기에는 약 300줄이라,
// CSS 를 읽어 flex gap 규칙마다 「자식 사이 여백」 규칙을 만든다. 만든 규칙은 html.no-flex-gap 아래에만
// 걸리고, 그 표시는 그 기기가 정말 flex gap 을 모를 때만 js/mini-compat.js 가 단다(최신 기기에서 두 번 붙지 않게).
//
//   가로 줄            .a>*+*  { margin-left: <열 간격> }
//   세로 줄(column)    .a>*+*  { margin-top:  <줄 간격> }
//   감싸는 줄(wrap)    .a>*    { margin-right: <열 간격>; margin-bottom: <줄 간격> }
//   grid 의 gap 은 74 판도 알므로 건드리지 않는다. @media · @supports 안의 것은 그 안에 그대로 둔다
//
//   node scripts/mini-cssfix.mjs <www-mini 폴더>  → <폴더>/css/mini-gap.css
// ============================================================================
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FLAG = "no-flex-gap";

// 주석을 지운다(문자열 안의 /* 는 그대로)
function stripComments(css) {
  let out = "", i = 0, q = null;
  while (i < css.length) {
    const c = css[i];
    if (q) { out += c; if (c === "\\") { out += css[i + 1] || ""; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
    if (c === "/" && css[i + 1] === "*") { const e = css.indexOf("*/", i + 2); i = e < 0 ? css.length : e + 2; out += " "; continue; }
    out += c; i++;
  }
  return out;
}

// 여는 { 에 짝이 맞는 } 의 자리(문자열 안의 괄호는 건너뛴다)
function closeOf(css, open) {
  let depth = 0, q = null;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return css.length;
}

// 맨 위 수준에서 쉼표·쌍반점으로 나눈다(괄호·문자열 안은 나누지 않는다)
function splitTop(s, sep) {
  const out = []; let cur = "", depth = 0, q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function decls(body) {
  const m = {};
  for (const d of splitTop(body, ";")) {
    const k = d.indexOf(":");
    if (k < 0) continue;
    m[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).replace(/!important/i, "").trim();
  }
  return m;
}

function prefixSel(sel, suffix) {
  return splitTop(sel, ",").map(s => {
    s = s.trim();
    const m = /^(html|:root)(?![\w-])/i.exec(s);
    const head = m ? m[1] + "." + FLAG + s.slice(m[0].length) : "." + FLAG + " " + s;
    return head + suffix;
  }).join(",");
}

// 규칙 하나 → 대체 규칙(없으면 "")
function ruleFix(sel, body) {
  if (/@|^\s*$/.test(sel) || /::?(before|after|placeholder|selection)/i.test(sel)) return "";
  const d = decls(body);
  let row = null, col = null;
  if (d.gap) { const p = d.gap.split(/\s+(?![^(]*\))/); row = p[0]; col = p[1] || p[0]; }
  if (d["row-gap"]) row = d["row-gap"];
  if (d["column-gap"]) col = d["column-gap"];
  if (!row && !col) return "";
  const display = (d.display || "").toLowerCase();
  const gridish = /grid/.test(display) || Object.keys(d).some(k => k.startsWith("grid-template") || k.startsWith("grid-auto"));
  if (gridish) return "";
  const flexHint = /flex/.test(display) || ["flex-direction", "flex-wrap", "flex-flow", "justify-content", "align-items"].some(k => k in d);
  if (!flexHint || (display && !/flex|none/.test(display))) return "";
  const flow = ((d["flex-direction"] || "") + " " + (d["flex-flow"] || "")).toLowerCase();
  const wrap = /wrap(?!-reverse)|wrap-reverse/.test(((d["flex-wrap"] || "") + " " + (d["flex-flow"] || "")).toLowerCase()) && !/nowrap/.test(d["flex-wrap"] || "");
  const column = /column/.test(flow);
  if (wrap) {
    const parts = [];
    if (col && col !== "0" && !column) parts.push(`margin-right:${col}`);
    if (row && row !== "0") parts.push(`margin-bottom:${row}`);
    if (column && col && col !== "0") parts.push(`margin-right:${col}`);
    return parts.length ? `${prefixSel(sel, ">*")}{${parts.join(";")}}` : "";
  }
  if (column) return row && row !== "0" ? `${prefixSel(sel, ">*+*")}{margin-top:${row}}` : "";
  return col && col !== "0" ? `${prefixSel(sel, ">*+*")}{margin-left:${col}}` : "";
}

function walk(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    let prelude = css.slice(i, open);
    // 앞에 붙은 @import ...; 같은 문장은 떼어 낸다
    const semi = prelude.lastIndexOf(";");
    if (semi >= 0 && !/\{/.test(prelude)) prelude = prelude.slice(semi + 1);
    const close = closeOf(css, open);
    const inner = css.slice(open + 1, close);
    const p = prelude.trim();
    if (/^@(media|supports)\b/i.test(p)) {
      const sub = walk(inner);
      if (sub) out.push(`${p}{\n${sub}\n}`);
    } else if (!p.startsWith("@")) {
      const f = ruleFix(p, inner);
      if (f) out.push(f);
    }
    i = close + 1;
  }
  return out.join("\n");
}

/** CSS 글 → flex gap 대체 규칙(html.no-flex-gap 아래) */
export function gapFallback(css) {
  return walk(stripComments(String(css || "")));
}

/** 폴더의 css/*.css 와 *.html 안 <style> 에서 대체 규칙을 모아 css/mini-gap.css 로 */
export async function buildGapCss(dir) {
  const chunks = [];
  const cssDir = join(dir, "css");
  if (existsSync(cssDir)) {
    for (const f of (await readdir(cssDir)).sort()) {
      if (!f.endsWith(".css") || f.startsWith("mini-")) continue;
      const g = gapFallback(await readFile(join(cssDir, f), "utf8"));
      if (g) chunks.push(`/* ── css/${f} ── */\n${g}`);
    }
  }
  for (const f of (await readdir(dir)).sort()) {
    if (!f.endsWith(".html")) continue;
    const html = await readFile(join(dir, f), "utf8");
    const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join("\n");
    const g = gapFallback(styles);
    if (g) chunks.push(`/* ── ${f} <style> ── */\n${g}`);
  }
  const text = `/* 만든 파일 — scripts/mini-cssfix.mjs. 손으로 고치지 않는다(원본 CSS 를 고치면 다음 빌드에 다시 만들어진다) */\n${chunks.join("\n")}\n`;
  await writeFile(join(cssDir, "mini-gap.css"), text);
  return { rules: (text.match(/\{/g) || []).length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) { console.error("쓰는 법: node scripts/mini-cssfix.mjs <www-mini 폴더>"); process.exit(1); }
  buildGapCss(dir).then(r => console.log(`칸 띄우기 대체 규칙 ${r.rules}개 → css/mini-gap.css`))
    .catch(e => { console.error("✗ " + e.message); process.exit(1); });
}
