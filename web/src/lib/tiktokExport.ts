import { strFromU8, unzipSync } from 'fflate';

/**
 * Reads a TikTok "Download your data" export (ZIP, JSON or TXT) entirely in the browser.
 * Only video links from the like / favourite / repost sections leave this function —
 * DMs, watch history, location etc. are never sent anywhere.
 *
 * TikTok doesn't document the export schema and has renamed keys before, so instead of
 * hard-coding paths we find every video URL and classify it by the section it sits in.
 */

export type ExportCategory = 'likes' | 'favorites' | 'reposts';

export interface ExportItem {
  videoId: string;
  url: string;
  date: number | null;
}

export type ParsedExport = Record<ExportCategory, ExportItem[]>;

const VIDEO_URL =
  /https?:\/\/(?:www\.)?(?:tiktokv\.(?:com|eu|us)\/share\/video\/(\d{8,25})\/?|tiktok\.com\/@[^\s"'/]*\/video\/(\d{8,25}))/g;

function categorize(path: string): ExportCategory | null {
  const p = path.toLowerCase();
  // Shared links inside DMs or the watch history are not "likes".
  if (/message|chat|brows|watch|search|comment/.test(p)) return null;
  if (/like/.test(p)) return 'likes';
  if (/favou?rite|collect/.test(p)) return 'favorites';
  if (/repost/.test(p)) return 'reposts';
  return null;
}

const parseDate = (v: unknown) => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  // TXT exports write "2026-10-27 18:11:45 UTC", which Date can't parse as-is.
  const t = new Date(typeof v === 'string' ? v.trim().replace(' ', 'T').replace(/\s*UTC$/i, 'Z') : v).getTime();
  return Number.isFinite(t) ? t : null;
};

class Collector {
  out: ParsedExport = { likes: [], favorites: [], reposts: [] };
  private seen: Record<ExportCategory, Set<string>> = { likes: new Set(), favorites: new Set(), reposts: new Set() };

  add(path: string, text: string, date: number | null) {
    const cat = categorize(path);
    if (!cat) return;
    for (const m of text.matchAll(VIDEO_URL)) {
      const videoId = m[1] ?? m[2];
      if (this.seen[cat].has(videoId)) continue;
      this.seen[cat].add(videoId);
      this.out[cat].push({ videoId, url: m[0], date });
    }
  }

  json(node: unknown, path: string) {
    if (typeof node === 'string') return this.add(path, node, null);
    if (Array.isArray(node)) return node.forEach((n, i) => this.json(n, `${path}/${i}`));
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const dateKey = Object.keys(obj).find((k) => /date|time/i.test(k));
    const date = dateKey ? parseDate(obj[dateKey]) : null;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') this.add(`${path}/${k}`, v, date);
      else this.json(v, `${path}/${k}`);
    }
  }

  txt(text: string, fileName: string) {
    let section = '';
    let lastDate: number | null = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const dateMatch = line.match(/^date\s*:\s*(.+)$/i);
      if (dateMatch) {
        lastDate = parseDate(dateMatch[1]);
        continue;
      }
      if (/https?:\/\//.test(line)) {
        this.add(`${fileName}/${section}`, line, lastDate);
        continue;
      }
      // A line that isn't "Key: value" is a section header ("Like List", "Favorite Videos", …).
      if (!/^[^:]{1,40}:\s+\S/.test(line)) section = line;
    }
  }

  result(): ParsedExport {
    for (const list of Object.values(this.out)) list.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
    return this.out;
  }
}

function readText(c: Collector, name: string, text: string) {
  if (name.toLowerCase().endsWith('.json')) {
    try {
      c.json(JSON.parse(text), name);
      return;
    } catch {
      /* fall through to plain-text scan */
    }
  }
  c.txt(text, name);
}

export async function parseTikTokExport(file: File): Promise<ParsedExport> {
  const c = new Collector();
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
  if (isZip) {
    const files = unzipSync(buf, { filter: (f) => /\.(json|txt)$/i.test(f.name) && f.originalSize < 200 * 1024 * 1024 });
    for (const [name, data] of Object.entries(files)) readText(c, name, strFromU8(data));
  } else {
    readText(c, file.name, strFromU8(buf));
  }
  return c.result();
}

/** Take a random sample from the most recent `window` items (older likes are more often deleted). */
export function sampleForGame(items: ExportItem[], max: number, window = 1500): string[] {
  const recent = items.slice(0, window);
  for (let i = recent.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [recent[i], recent[j]] = [recent[j], recent[i]];
  }
  return recent.slice(0, max).map((i) => i.url);
}
