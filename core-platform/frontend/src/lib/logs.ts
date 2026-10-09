// Pure helpers that turn raw deployment log lines into something readable.

export type Level = 'error' | 'warn' | 'success' | 'step' | 'info' | 'dim';

export interface LogLine {
  n: number;            // 1-based line number in the stream
  time: string;         // "5:34:29 PM" or ''
  text: string;         // message without the timestamp
  level: Level;
  urls: string[];       // http(s) URLs found in the text
  isAppUrl: boolean;    // the "App URL:" line printed on success
  divider: boolean;     // pure decoration (═══ / ---)
  indented: boolean;    // tool output (docker/git) printed by the pipeline with a leading indent
}

export interface LogGroup {
  id: number;
  title: string;
  lines: LogLine[];
  status: 'pending' | 'running' | 'done' | 'failed';
}

const TS = /^\[([^\]]{3,24})\]\s?/;
export const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

const DECOR = /^[\s═=\-─━*_~•·|]+$/;
const STEP_HEADER = /^\S{0,4}\s*(?:STEP|Step)\s+(\d)\/4\b/;                 // pipeline "STEP 2/4", not docker's indented "Step 2/8"
const BANNER_TITLE = /DEPLOYMENT (STARTED|SUCCESSFUL|FAILED|COMPLETE)|Deployment Pipeline:/i;

export function classify(text: string, rawIndented: boolean): Level {
  if (!rawIndented && (STEP_HEADER.test(text) || BANNER_TITLE.test(text))) return 'step';
  if (/❌|💥|\berror\b|\bfatal\b|exception|traceback|\bfailed\b|denied|unhealthy|crash-?loop|ENOENT|ECONNREFUSED|not reachable|cannot /i.test(text)
      && !/0 failed|failed: 0/i.test(text)) return 'error';
  if (/⚠|\bwarn(ing)?\b|deprecated|timed out|not found\. using/i.test(text)) return 'warn';
  if (/✅|🛡|successful|successfully|healthy\.|rolled back|app url|is live/i.test(text)) return 'success';
  // Indented lines are tool output (docker build, git): de-emphasise them.
  if (rawIndented) return 'dim';
  return 'info';
}

/** One raw entry may contain several lines ("\n📦 STEP 1/4 …"); returns structured lines. */
export function parseLogs(raw: string[]): LogLine[] {
  const out: LogLine[] = [];
  for (const entry of raw) {
    let rest = entry;
    let time = '';
    const m = rest.match(TS);
    if (m) { time = m[1]; rest = rest.slice(m[0].length); }
    for (const piece of rest.split(/\r?\n/)) {
      if (!piece.trim()) continue;
      const indented = /^\s{2,}/.test(piece) || /^\s*[│>]/.test(piece);
      const text = piece.trim();
      const divider = DECOR.test(text) || /^\S{0,3}\s*[═─=-]{6,}\s*\S{0,3}$/.test(text);
      const urls = (text.match(URL_RE) || []).map(u => u.replace(/[.,;]+$/, ''));
      out.push({
        n: out.length + 1,
        time,
        text,
        level: divider ? 'dim' : classify(text, indented),
        urls,
        isAppUrl: /app url\s*:/i.test(text) && urls.length > 0,
        divider,
        indented,
      });
    }
  }
  return out;
}

/** Group lines under the pipeline step headers so long build output can be folded away. */
export function groupLines(lines: LogLine[], finished: boolean, failed: boolean): LogGroup[] {
  const groups: LogGroup[] = [];
  let cur: LogGroup | null = null;
  for (const l of lines) {
    if (l.divider) continue;
    if ((!l.indented && STEP_HEADER.test(l.text)) || (l.level === 'step' && !cur)) {
      cur = { id: groups.length, title: l.text.replace(/^\S{0,4}\s*/, '').replace(/\s*[—–-]\s*/, ' · '), lines: [], status: 'running' };
      groups.push(cur);
    } else if (!cur) {
      cur = { id: 0, title: 'Setup', lines: [], status: 'running' };
      groups.push(cur);
    }
    cur.lines.push(l);
  }
  groups.forEach((g, i) => {
    const hasError = g.lines.some(l => l.level === 'error');
    const last = i === groups.length - 1;
    if (hasError && (last || failed)) g.status = 'failed';
    else if (!last || finished) g.status = hasError && failed ? 'failed' : 'done';
    else g.status = 'running';
  });
  return groups;
}

export interface Stage { label: string; state: 'pending' | 'active' | 'done' | 'failed' }

const STAGE_LABELS = ['Fetch code', 'Dockerfile', 'Build image', 'Start & verify'];

/** The four pipeline stages the backend announces ("STEP n/4"). */
export function pipelineStages(lines: LogLine[], status: string): Stage[] {
  let reached = 0;
  for (const l of lines) {
    const m = l.indented ? null : l.text.match(STEP_HEADER);
    if (m) reached = Math.max(reached, Number(m[1]));
  }
  const failed = status === 'failed';
  const done = status === 'success';
  return STAGE_LABELS.map((label, i) => {
    const idx = i + 1;
    if (done) return { label, state: 'done' as const };
    if (idx < reached) return { label, state: 'done' as const };
    if (idx === reached) return { label, state: failed ? 'failed' as const : 'active' as const };
    return { label, state: 'pending' as const };
  });
}

export function countByLevel(lines: LogLine[]) {
  const c = { error: 0, warn: 0, step: 0, success: 0 };
  for (const l of lines) if (!l.divider && l.level in c) (c as any)[l.level]++;
  return c;
}

export function splitHighlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  const low = text.toLowerCase(), lq = q.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const j = low.indexOf(lq, i);
    if (j < 0) { parts.push({ text: text.slice(i), hit: false }); break; }
    if (j > i) parts.push({ text: text.slice(i, j), hit: false });
    parts.push({ text: text.slice(j, j + q.length), hit: true });
    i = j + q.length;
  }
  return parts;
}

/** Plain text of the raw log, for copy / download. */
export function toPlainText(raw: string[]): string {
  return raw.map(r => r.replace(/\r?\n+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** The first meaningful error message in the log, for the "what went wrong" summary. */
export function firstError(lines: LogLine[]): LogLine | undefined {
  return lines.find(l => l.level === 'error' && !/DEPLOYMENT FAILED|^[❌\s]*$/.test(l.text) && !l.divider)
      || lines.find(l => l.level === 'error');
}
