var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/run.ts
var import_strict = __toESM(require("node:assert/strict"), 1);
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// src/lib/logs.ts
var TS = /^\[([^\]]{3,24})\]\s?/;
var URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
var DECOR = /^[\s═=\-─━*_~•·|]+$/;
var STEP_HEADER = /^\S{0,4}\s*(?:STEP|Step)\s+(\d)\/4\b/;
var BANNER_TITLE = /DEPLOYMENT (STARTED|SUCCESSFUL|FAILED|COMPLETE)|Deployment Pipeline:/i;
function classify(text, rawIndented) {
  if (!rawIndented && (STEP_HEADER.test(text) || BANNER_TITLE.test(text))) return "step";
  if (/❌|💥|\berror\b|\bfatal\b|exception|traceback|\bfailed\b|denied|unhealthy|crash-?loop|ENOENT|ECONNREFUSED|not reachable|cannot /i.test(text) && !/0 failed|failed: 0/i.test(text)) return "error";
  if (/⚠|\bwarn(ing)?\b|deprecated|timed out|not found\. using/i.test(text)) return "warn";
  if (/✅|🛡|successful|successfully|healthy\.|rolled back|app url|is live/i.test(text)) return "success";
  if (rawIndented) return "dim";
  return "info";
}
function parseLogs(raw) {
  const out = [];
  for (const entry of raw) {
    let rest = entry;
    let time = "";
    const m = rest.match(TS);
    if (m) {
      time = m[1];
      rest = rest.slice(m[0].length);
    }
    for (const piece of rest.split(/\r?\n/)) {
      if (!piece.trim()) continue;
      const indented = /^\s{2,}/.test(piece) || /^\s*[│>]/.test(piece);
      const text = piece.trim();
      const divider = DECOR.test(text) || /^\S{0,3}\s*[═─=-]{6,}\s*\S{0,3}$/.test(text);
      const urls = (text.match(URL_RE) || []).map((u) => u.replace(/[.,;]+$/, ""));
      out.push({
        n: out.length + 1,
        time,
        text,
        level: divider ? "dim" : classify(text, indented),
        urls,
        isAppUrl: /app url\s*:/i.test(text) && urls.length > 0,
        divider,
        indented
      });
    }
  }
  return out;
}
function groupLines(lines, finished, failed) {
  const groups = [];
  let cur = null;
  for (const l of lines) {
    if (l.divider) continue;
    if (!l.indented && STEP_HEADER.test(l.text) || l.level === "step" && !cur) {
      cur = { id: groups.length, title: l.text.replace(/^\S{0,4}\s*/, "").replace(/\s*[—–-]\s*/, " \xB7 "), lines: [], status: "running" };
      groups.push(cur);
    } else if (!cur) {
      cur = { id: 0, title: "Setup", lines: [], status: "running" };
      groups.push(cur);
    }
    cur.lines.push(l);
  }
  groups.forEach((g, i) => {
    const hasError = g.lines.some((l) => l.level === "error");
    const last = i === groups.length - 1;
    if (hasError && (last || failed)) g.status = "failed";
    else if (!last || finished) g.status = hasError && failed ? "failed" : "done";
    else g.status = "running";
  });
  return groups;
}
var STAGE_LABELS = ["Fetch code", "Dockerfile", "Build image", "Start & verify"];
function pipelineStages(lines, status) {
  let reached = 0;
  for (const l of lines) {
    const m = l.indented ? null : l.text.match(STEP_HEADER);
    if (m) reached = Math.max(reached, Number(m[1]));
  }
  const failed = status === "failed";
  const done = status === "success";
  return STAGE_LABELS.map((label, i) => {
    const idx = i + 1;
    if (done) return { label, state: "done" };
    if (idx < reached) return { label, state: "done" };
    if (idx === reached) return { label, state: failed ? "failed" : "active" };
    return { label, state: "pending" };
  });
}
function countByLevel(lines) {
  const c = { error: 0, warn: 0, step: 0, success: 0 };
  for (const l of lines) if (!l.divider && l.level in c) c[l.level]++;
  return c;
}
function splitHighlight(text, query) {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const parts = [];
  const low = text.toLowerCase(), lq = q.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const j = low.indexOf(lq, i);
    if (j < 0) {
      parts.push({ text: text.slice(i), hit: false });
      break;
    }
    if (j > i) parts.push({ text: text.slice(i, j), hit: false });
    parts.push({ text: text.slice(j, j + q.length), hit: true });
    i = j + q.length;
  }
  return parts;
}
function toPlainText(raw) {
  return raw.map((r) => r.replace(/\r?\n+/g, " ").trim()).filter(Boolean).join("\n");
}
function firstError(lines) {
  return lines.find((l) => l.level === "error" && !/DEPLOYMENT FAILED|^[❌\s]*$/.test(l.text) && !l.divider) || lines.find((l) => l.level === "error");
}

// tests/run.ts
var load = (n) => JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.resolve)(process.cwd(), "tests", "fixtures", `${n}.json`), "utf8"));
var ok = load("deploy_success");
var bad = load("deploy_failed");
var passed = 0;
var test = (name, fn) => {
  fn();
  passed++;
  console.log("  \u2713", name);
};
test("a raw entry with embedded newlines becomes separate lines and timestamps are split off", () => {
  const lines = parseLogs(["[5:34:29 PM] \n\u{1F4E6} STEP 1/4 \u2014 Fetching repository...", "[5:34:30 PM]   Step 3/8 : RUN npm install"]);
  import_strict.default.equal(lines.length, 2);
  import_strict.default.equal(lines[0].time, "5:34:29 PM");
  import_strict.default.equal(lines[0].level, "step");
  import_strict.default.equal(lines[1].level, "dim");
});
test("successful deployment: app URL line is detected with its URL", () => {
  const lines = parseLogs(ok.logs);
  const u = lines.find((l) => l.isAppUrl);
  import_strict.default.ok(u, "no App URL line found");
  import_strict.default.equal(u.urls[0], ok.app_url);
  import_strict.default.equal(u.level, "success");
  import_strict.default.equal(countByLevel(lines).error, 0);
});
test("successful deployment: four pipeline stages, all done; groups are done", () => {
  const lines = parseLogs(ok.logs);
  const stages = pipelineStages(lines, "success");
  import_strict.default.deepEqual(stages.map((s) => s.state), ["done", "done", "done", "done"]);
  const groups = groupLines(lines, true, false);
  import_strict.default.ok(groups.length >= 4);
  import_strict.default.ok(groups.every((g) => g.status === "done"));
});
test("failed deployment: error found, stage 4 marked failed, rollback is not an error", () => {
  const lines = parseLogs(bad.logs);
  const err = firstError(lines);
  import_strict.default.ok(err && /not healthy|exited/i.test(err.text), err?.text);
  const stages = pipelineStages(lines, "failed");
  import_strict.default.deepEqual(stages.map((s) => s.state), ["done", "done", "done", "failed"]);
  const rolled = lines.find((l) => /Rolled back/.test(l.text));
  import_strict.default.equal(rolled.level, "success");
  import_strict.default.ok(groupLines(lines, true, true).some((g) => g.status === "failed"));
});
test("decoration lines are dividers, never errors/steps", () => {
  const lines = parseLogs(["[1:00:00 PM] \u274C \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550", "[1:00:00 PM] \u{1F680} \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"]);
  import_strict.default.ok(lines.every((l) => l.divider && l.level === "dim"));
});
test("live (unfinished) pipeline: current stage is active, later ones pending", () => {
  const lines = parseLogs(ok.logs.slice(0, 14));
  const states = pipelineStages(lines, "building").map((s) => s.state);
  import_strict.default.ok(states.includes("active") && states.includes("pending"), states.join());
});
test("classifier basics", () => {
  import_strict.default.equal(classify("npm WARN deprecated foo", true), "warn");
  import_strict.default.equal(classify("Error: listen EADDRINUSE", false), "error");
  import_strict.default.equal(classify("0 failed, 5 passed", false), "info");
  import_strict.default.equal(classify("\u2705 Image built successfully", false), "success");
  import_strict.default.equal(classify("Cloning into .", false), "info");
});
test("docker's own indented 'Step 3/4' is not a pipeline step", () => {
  const lines = parseLogs(["[1:00:00 PM] \u{1F528} STEP 3/4 \u2014 Building Docker image", "[1:00:01 PM]   Step 3/4 : RUN npm install", '[1:00:02 PM]   Step 4/4 : CMD ["node"]']);
  import_strict.default.deepEqual(pipelineStages(lines, "building").map((s) => s.state), ["done", "done", "active", "pending"]);
  import_strict.default.equal(groupLines(lines, false, false).length, 1);
});
test("search highlight and plain-text export", () => {
  import_strict.default.deepEqual(splitHighlight("Hello World hello", "hello").map((p) => p.hit), [true, false, true]);
  import_strict.default.deepEqual(splitHighlight("abc", ""), [{ text: "abc", hit: false }]);
  import_strict.default.ok(!toPlainText(ok.logs).includes("\n\n"));
});
console.log(`
${passed} tests passed`);
