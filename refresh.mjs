// deploy/cloud-entry.ts
import fs4 from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";

// scripts/refresh-discovery.ts
import fs2 from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/domain.ts
import { z } from "zod";
var companies = ["tj", "ky"];
var normalize = (s) => s.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\p{Z}\s\p{P}]/gu, "");
var timestamp = z.string().datetime();
var source = z.string().url().refine((s) => {
  const u = new URL(s);
  return u.protocol === "https:" && ["www.tjmedia.com", "tjmedia.com", "kysing.kr"].includes(u.hostname);
}, "TJ \uB610\uB294 KYSing \uACF5\uC2DD HTTPS \uCD9C\uCC98\uB9CC \uD5C8\uC6A9");
var aliasSchema = z.object({
  text: z.string().trim().min(1),
  field: z.enum(["title", "artist"]),
  kind: z.enum(["reviewed", "generated"]),
  reviewer: z.string().optional(),
  generator: z.string().optional(),
  sourceUrl: source.optional(),
  sourcePage: z.number().int().positive().optional()
}).strict().superRefine((a, ctx) => {
  if (a.kind === "reviewed" && !a.reviewer) ctx.addIssue({ code: "custom", message: "\uAC80\uC218\uC790 \uD544\uC694" });
  if (a.kind === "generated" && !a.generator) ctx.addIssue({ code: "custom", message: "\uC0DD\uC131 \uBC29\uC2DD \uD544\uC694" });
});
var registrationSchema = z.object({
  status: z.enum(["registered", "unregistered", "pending"]),
  number: z.string().regex(/^\d{1,7}$/).optional(),
  sourceUrl: source.optional(),
  checkedAt: timestamp.optional(),
  evidenceFile: z.string().regex(/^[a-zA-Z0-9_\-\p{L}]+\.json$/u).optional(),
  sourceTitle: z.string().optional(),
  sourceArtist: z.string().optional(),
  absenceReason: z.string().optional(),
  lastAttemptAt: timestamp.optional(),
  lastError: z.string().optional()
}).strict().superRefine((r, ctx) => {
  const issue = (message) => ctx.addIssue({ code: "custom", message });
  if (r.status === "registered" && (!r.number || !r.sourceTitle || !r.sourceArtist)) issue("\uB4F1\uB85D \uBC88\uD638\uC640 \uACF5\uC2DD \uC81C\uBAA9\xB7\uAC00\uC218 \uD544\uC694");
  if (r.status !== "registered" && r.number) issue("\uBBF8\uB4F1\uB85D/\uD655\uC778 \uC911\uC5D0 \uBC88\uD638 \uAE08\uC9C0");
  if (r.status !== "pending" && (!r.sourceUrl || !r.checkedAt || !r.evidenceFile)) issue("\uD655\uC815 \uC0C1\uD0DC\uB294 \uACF5\uC2DD \uCD9C\uCC98\xB7\uD655\uC778 \uC2DC\uAC01\xB7\uC99D\uAC70 \uD544\uC694");
  if (r.status === "unregistered" && !r.absenceReason) issue("\uBBF8\uB4F1\uB85D\uC740 \uC644\uC804\uD55C \uC870\uD68C \uBC94\uC704\uC640 \uAC80\uC218 \uADFC\uAC70 \uD544\uC694");
});
var songSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  workId: z.string().min(1),
  artistId: z.string().min(1),
  titleKo: z.string().min(1),
  artistKo: z.string().min(1),
  titleOriginal: z.string().min(1),
  artistOriginal: z.string().min(1),
  version: z.string().min(1),
  aliases: z.array(aliasSchema),
  titleMeaningKo: z.object({ text: z.string().min(1), kind: z.enum(["editorial-literal", "proper-name"]), reviewer: z.string().min(1) }).strict().optional(),
  localization: z.object({ title: z.enum(["reviewed", "official-reading", "generated", "pending"]), artist: z.enum(["reviewed", "official-reading", "generated", "pending"]) }).strict().optional(),
  registrations: z.object({ tj: registrationSchema, ky: registrationSchema }).strict()
}).strict();
var catalogBaseSchema = z.object({
  schemaVersion: z.literal(1),
  revision: timestamp,
  coverage: z.object({ scope: z.enum(["verified-pilot", "official-web-snapshot"]), notice: z.string(), totalUniverse: z.null() }).strict(),
  songs: z.array(songSchema)
}).strict();
function validateCatalog(c, ctx) {
  const ids = /* @__PURE__ */ new Set(), numbers = /* @__PURE__ */ new Set(), identities = /* @__PURE__ */ new Set();
  for (const s of c.songs) {
    const identity = [s.workId, s.artistId, normalize(s.version)].join("|");
    if (ids.has(s.id) || identities.has(identity)) ctx.addIssue({ code: "custom", message: `\uC911\uBCF5 \uACE1/\uBC84\uC804 ${s.id}` });
    ids.add(s.id);
    identities.add(identity);
    const aliases = /* @__PURE__ */ new Set();
    for (const a of s.aliases) {
      const k = a.field + normalize(a.text);
      if (aliases.has(k)) ctx.addIssue({ code: "custom", message: `\uC911\uBCF5 \uBCC4\uCE6D ${s.id}: ${a.text}` });
      aliases.add(k);
    }
    for (const company of companies) {
      const r = s.registrations[company];
      if (!r) continue;
      if (r.sourceUrl && company === "ky" !== (new URL(r.sourceUrl).hostname === "kysing.kr")) ctx.addIssue({ code: "custom", message: "\uD68C\uC0AC\uC640 \uCD9C\uCC98 \uBD88\uC77C\uCE58" });
      if (r.number) {
        const k = company + ":" + r.number;
        if (numbers.has(k)) ctx.addIssue({ code: "custom", message: `\uD68C\uC0AC\uBCC4 \uBC88\uD638 \uC911\uBCF5 ${k}` });
        numbers.add(k);
      }
    }
  }
}
var catalogSchema = catalogBaseSchema.superRefine(validateCatalog);
var tjSongSchema = songSchema.extend({ registrations: z.object({ tj: registrationSchema }).strict() });
var tjCatalogSchema = catalogBaseSchema.extend({ songs: z.array(tjSongSchema) }).superRefine(validateCatalog);

// src/discovery.ts
import { z as z2 } from "zod";
var stamp = z2.string().datetime();
var date = z2.string().regex(/^\d{4}-\d{2}-\d{2}$/);
var official = z2.string().url().refine((value) => new URL(value).origin === "https://www.tjmedia.com");
var discoverySchema = z2.object({
  schemaVersion: z2.literal(1),
  updatedAt: stamp,
  lastAttemptAt: stamp,
  archive: z2.array(tjSongSchema).default([]),
  schedule: z2.object({ timezone: z2.literal("Asia/Seoul"), hours: z2.array(z2.number().int().min(0).max(23)) }).strict(),
  monthly: z2.object({ month: z2.string().regex(/^\d{4}-\d{2}$/), checkedAt: stamp, sourceUrl: official, totalFetched: z2.number().int().nonnegative(), unclassifiedCount: z2.number().int().nonnegative(), entries: z2.array(z2.object({ song: tjSongSchema, addedOn: date }).strict()) }).strict().nullable(),
  top100: z2.object({ startDate: date, endDate: date, checkedAt: stamp, sourceUrl: official, entries: z2.array(z2.object({ rank: z2.number().int().min(1).max(100), song: tjSongSchema }).strict()).length(100) }).strict().nullable(),
  errors: z2.array(z2.object({ part: z2.enum(["monthly", "top100", "refresh"]), at: stamp, message: z2.string() }).strict())
}).strict().superRefine((feed2, ctx) => {
  const issue = (message) => ctx.addIssue({ code: "custom", message });
  const monthlyIds = /* @__PURE__ */ new Set();
  for (const entry of feed2.monthly?.entries ?? []) {
    if (entry.addedOn.slice(0, 7) !== feed2.monthly.month) issue("Month mismatch");
    if (monthlyIds.has(entry.song.id)) issue("Duplicate monthly song");
    monthlyIds.add(entry.song.id);
  }
  const ranks = /* @__PURE__ */ new Set(), chartIds = /* @__PURE__ */ new Set();
  for (const entry of feed2.top100?.entries ?? []) {
    if (ranks.has(entry.rank) || chartIds.has(entry.song.id)) issue("Duplicate chart rank/song");
    ranks.add(entry.rank);
    chartIds.add(entry.song.id);
  }
  if (feed2.top100 && feed2.top100.startDate > feed2.top100.endDate) issue("Invalid chart period");
  const numbers = /* @__PURE__ */ new Map(), ids = /* @__PURE__ */ new Map();
  for (const song of [...feed2.archive, ...feed2.monthly?.entries.map((e) => e.song) ?? [], ...feed2.top100?.entries.map((e) => e.song) ?? []]) {
    const number = song.registrations.tj.number;
    if (song.registrations.tj.status !== "registered") issue("Unverified discovery number");
    if (numbers.has(number) && numbers.get(number) !== song.id || ids.has(song.id) && ids.get(song.id) !== number) issue("Discovery identity conflict");
    numbers.set(number, song.id);
    ids.set(song.id, number);
  }
});
function discoverySongs(feed2) {
  return [...new Map([...feed2?.archive ?? [], ...feed2?.monthly?.entries.map((e) => e.song) ?? [], ...feed2?.top100?.entries.map((e) => e.song) ?? []].map((song) => [song.id, song])).values()];
}
function koreanDate(now = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// src/kana-draft.ts
var rows = [
  ["\u3042\u3044\u3046\u3048\u304A", "\uC544\uC774\uC6B0\uC5D0\uC624"],
  ["\u304B\u304D\u304F\u3051\u3053", "\uCE74\uD0A4\uCFE0\uCF00\uCF54"],
  ["\u304C\u304E\u3050\u3052\u3054", "\uAC00\uAE30\uAD6C\uAC8C\uACE0"],
  ["\u3055\u3057\u3059\u305B\u305D", "\uC0AC\uC2DC\uC2A4\uC138\uC18C"],
  ["\u3056\u3058\u305A\u305C\u305E", "\uC790\uC9C0\uC988\uC81C\uC870"],
  ["\u305F\u3061\u3064\u3066\u3068", "\uD0C0\uCE58\uCE20\uD14C\uD1A0"],
  ["\u3060\u3062\u3065\u3067\u3069", "\uB2E4\uC9C0\uC988\uB370\uB3C4"],
  ["\u306A\u306B\u306C\u306D\u306E", "\uB098\uB2C8\uB204\uB124\uB178"],
  ["\u306F\u3072\u3075\u3078\u307B", "\uD558\uD788\uD6C4\uD5E4\uD638"],
  ["\u3070\u3073\u3076\u3079\u307C", "\uBC14\uBE44\uBD80\uBCA0\uBCF4"],
  ["\u3071\u3074\u3077\u307A\u307D", "\uD30C\uD53C\uD478\uD398\uD3EC"],
  ["\u307E\u307F\u3080\u3081\u3082", "\uB9C8\uBBF8\uBB34\uBA54\uBAA8"],
  ["\u3089\u308A\u308B\u308C\u308D", "\uB77C\uB9AC\uB8E8\uB808\uB85C"]
];
var map = /* @__PURE__ */ new Map();
for (const [kana, ko] of rows) [...kana].forEach((k, i) => map.set(k, [ko[i], "\uC544\uC774\uC6B0\uC5D0\uC624"[i]]));
map.set("\u3084", ["\uC57C", "\uC544"]);
map.set("\u3086", ["\uC720", "\uC6B0"]);
map.set("\u3088", ["\uC694", "\uC624"]);
map.set("\u308F", ["\uC640", "\uC544"]);
map.set("\u3092", ["\uC624", "\uC624"]);
function kanaReadingDraft(text) {
  const kana = text.normalize("NFKC").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 96));
  let result = "", vowel = "";
  for (const k of kana) {
    if (k === "\u30FC") {
      if (!vowel) return null;
      continue;
    }
    if (k === "\u3093") {
      const last = result.charCodeAt(result.length - 1) - 44032;
      if (last < 0 || last > 11171 || last % 28 !== 0) return null;
      result = result.slice(0, -1) + String.fromCharCode(44032 + last + 4);
      vowel = "";
      continue;
    }
    const item = map.get(k);
    if (!item) return null;
    result += item[0];
    vowel = item[1];
  }
  return result || null;
}

// src/title-presentation.ts
var mainTitle = (text) => text.replace(/\([^)]*\)|（[^）]*）/g, "").trim();

// scripts/tj-public-client.ts
import fs from "node:fs/promises";
import robotsParser from "robots-parser";
import { load } from "cheerio";
var base = "https://www.tjmedia.com";
var agent = "UtaNumberMetadata/0.2";
var TJPublicClient = class {
  constructor(statePath, maxRequests = 70, fetcher = fetch) {
    this.statePath = statePath;
    this.maxRequests = maxRequests;
    this.fetcher = fetcher;
  }
  statePath;
  maxRequests;
  fetcher;
  cookies = /* @__PURE__ */ new Map();
  lastAt = 0;
  requests = 0;
  blocked = false;
  robot = null;
  async init() {
    const state = JSON.parse(await fs.readFile(this.statePath, "utf8").catch(() => "{}"));
    if (state.blocked) throw Error("TJ access/rate-limit block recorded; inspect request-state.json before resuming");
    this.lastAt = state.lastAt ?? 0;
    const text = await this.request("/robots.txt");
    this.robot = robotsParser(base + "/robots.txt", text);
    if ((this.robot.getCrawlDelay(agent) ?? 0) > 3) throw Error("robots Crawl-delay exceeds configured interval");
    return text;
  }
  async request(path3, fields) {
    if (this.blocked) throw Error("TJ access blocked earlier in this run; no further requests");
    if (!path3.startsWith("/") || path3.startsWith("//")) throw Error("Official TJ path required");
    if (this.robot && this.robot.isAllowed(base + path3, agent) !== true) throw Error("robots path not allowed");
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 3e3 - (Date.now() - this.lastAt))));
    this.lastAt = Date.now();
    await fs.writeFile(this.statePath, JSON.stringify({ lastAt: this.lastAt, blocked: false }));
    const headers = { "User-Agent": agent, "Accept": fields ? "application/json" : "text/html" };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (fields) {
      const csrf = this.cookies.get("CSRF_TOKEN");
      if (!csrf) throw Error("Anonymous CSRF cookie missing; no bypass");
      headers["X-CSRF-TOKEN"] = decodeURIComponent(csrf);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers.Referer = base + (path3.endsWith("newSongOfMonth") ? "/song/recent_song" : "/chart/top100");
    }
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (++this.requests > this.maxRequests) throw Error("Per-run request budget reached; keep last good snapshot");
      this.lastAt = Date.now();
      await fs.writeFile(this.statePath, JSON.stringify({ lastAt: this.lastAt, blocked: false }));
      response = await this.fetcher(base + path3, { method: fields ? "POST" : "GET", headers, body: fields ? new URLSearchParams(fields) : void 0, redirect: "manual", signal: AbortSignal.timeout(3e4) });
      if ([401, 403, 429].includes(response.status)) {
        this.blocked = true;
        await fs.writeFile(this.statePath, JSON.stringify({ lastAt: this.lastAt, blocked: { status: response.status, retryAfter: response.headers.get("retry-after"), path: path3 } }));
        throw Error(`TJ HTTP ${response.status}; stopped without retry or access workaround`);
      }
      if (response.status >= 500 && attempt === 0) {
        await response.body?.cancel();
        await new Promise((r) => setTimeout(r, 4e3));
        continue;
      }
      break;
    }
    if (!response?.ok) throw Error(`TJ HTTP ${response?.status}; no access workaround`);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0], i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return response.text();
  }
  async json(path3, fields) {
    const text = await this.request(path3, fields);
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw Error("Expected official JSON, received invalid data or authentication page");
    }
    if (String(value.resultCode) !== "99" || !Array.isArray(value.resultData?.items)) throw Error("Unexpected TJ response schema");
    const data = value.resultData;
    if (Number(data.itemsTotalCount) !== data.items.length) throw Error("TJ response is incomplete");
    return data.items;
  }
  get count() {
    return this.requests;
  }
};
function parseJapaneseSearch(html, query, page) {
  const $ = load(html), selected = (id) => $(id + " option[selected]").last().attr("value");
  $("script,style").remove();
  if (/access denied|captcha|로봇이 아닙니다/i.test($("body").text())) throw Error("Access challenge; stop");
  if (selected("#nationType") !== "JPN" || selected("#strType") !== "16" || $("#searchTxt").val() !== query) throw Error("JPN search conditions changed");
  const count = $(".mo-pagenation-wrap .page-num").text().replace(/\s/g, "");
  const match = count.match(/^(\d+)\/(\d+)$/);
  const rows2 = [];
  $(".grid-container.list").each((_, el) => {
    const row = $(el), clean2 = (text) => text.replace(/\s+/g, " ").trim();
    const number = clean2(row.find(".num2").text()), title = clean2(row.find(".title3 .flex-box > p").text()), artist = clean2(row.find(".singer").text());
    if (/^\d+$/.test(number) && title && artist) rows2.push({ number, title, artist });
  });
  if (!match) {
    if (rows2.length === 0 && /검색 결과.*없|검색된.*없/.test($("body").text())) return { rows: rows2, totalPages: 1 };
    throw Error("JPN pagination missing");
  }
  const totalPages = Number(match[2]);
  if (Number(match[1]) !== page || totalPages < page || totalPages > 20 || rows2.some((row) => !row.number.includes(query)) || rows2.length > 100 || page < totalPages && rows2.length !== 100) throw Error("JPN page incomplete or inconsistent");
  return { rows: rows2, totalPages };
}

// scripts/refresh-discovery.ts
var clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
function parseRows(items, part, month) {
  const seen = /* @__PURE__ */ new Set(), ranks = /* @__PURE__ */ new Set();
  const result = items.map((item) => {
    const row = { number: clean(item.pro), title: clean(item.indexTitle), artist: clean(item.indexSong) };
    if (!/^\d{1,7}$/.test(row.number) || !row.title || !row.artist || seen.has(row.number)) throw Error("Missing/duplicate TJ metadata");
    seen.add(row.number);
    if (part === "monthly") {
      row.addedOn = clean(item.publishdate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.addedOn) || !row.addedOn.startsWith(month + "-")) throw Error("Monthly publish date missing or outside requested month");
    } else {
      row.rank = Number(item.rank);
      if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > 100 || ranks.has(row.rank)) throw Error("Invalid/duplicate chart rank");
      ranks.add(row.rank);
    }
    return row;
  });
  if (part === "top100" && result.length !== 100) throw Error("Incomplete TOP100; preserve previous chart");
  return result;
}
function localizeRow(row, known, artists, meanings, checkedAt, evidenceFile, sourceUrl) {
  const sameTitle = known && normalize(mainTitle(known.titleOriginal)) === normalize(mainTitle(row.title));
  const sameArtist = known && normalize(known.artistOriginal) === normalize(row.artist);
  const titleDraft = kanaReadingDraft(mainTitle(row.title)), artistDraft = kanaReadingDraft(row.artist);
  const artistName = artists.get(normalize(row.artist));
  const meaning = meanings[normalize(mainTitle(row.title))];
  const aliases = (known?.aliases ?? []).filter((a) => a.field === "title" ? sameTitle : sameArtist);
  if (titleDraft && !aliases.some((a) => a.field === "title" && normalize(a.text) === normalize(titleDraft))) aliases.push({ text: titleDraft, field: "title", kind: "generated", generator: "kana-reading-v2" });
  return tjSongSchema.parse({
    id: known?.id ?? "tj-" + row.number,
    workId: known?.workId ?? "tj-record-" + row.number,
    artistId: sameArtist ? known.artistId : "tj-artist-" + crypto.createHash("sha256").update(row.artist).digest("hex").slice(0, 16),
    titleKo: sameTitle ? known.titleKo : titleDraft ?? row.title,
    artistKo: sameArtist ? known.artistKo : artistName ?? artistDraft ?? row.artist,
    titleOriginal: row.title,
    artistOriginal: row.artist,
    version: known?.version ?? row.title.match(/[（(](?:movie|live|acoustic|unplugged|ライブ|アコースティック)\s*(?:ver(?:sion)?\.?)?[）)]/i)?.[0] ?? "\uACF5\uC2DD \uB4F1\uB85D\uACE1",
    aliases,
    ...sameTitle && known.titleMeaningKo ? { titleMeaningKo: known.titleMeaningKo } : meaning ? { titleMeaningKo: meaning } : {},
    localization: { title: sameTitle ? known.localization?.title ?? "reviewed" : titleDraft ? "generated" : "pending", artist: sameArtist ? known.localization?.artist ?? "reviewed" : artistName ? "reviewed" : artistDraft ? "generated" : "pending" },
    registrations: { tj: { status: "registered", number: row.number, sourceUrl, checkedAt, evidenceFile, sourceTitle: row.title, sourceArtist: row.artist } }
  });
}
async function atomicJson(filename, value) {
  await fs2.mkdir(path.dirname(filename), { recursive: true });
  const text = JSON.stringify(value, null, 2) + "\n";
  if (await fs2.readFile(filename, "utf8").catch(() => null) === text) return;
  const temporary = filename + `.${process.pid}.tmp`;
  await fs2.writeFile(temporary, text);
  for (let attempt = 0; attempt < 5; attempt++) try {
    await fs2.rename(temporary, filename);
    return;
  } catch (error) {
    if (attempt === 4) {
      await fs2.unlink(temporary).catch(() => {
      });
      throw error;
    }
    await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
  }
}
async function refreshDiscovery({ dryRun = false, now = /* @__PURE__ */ new Date() } = {}) {
  const root = "data/discovery";
  await fs2.mkdir(root + "/history", { recursive: true });
  const lock = root + "/refresh.lock";
  let lockHandle;
  try {
    lockHandle = await fs2.open(lock, "wx");
  } catch {
    throw Error("A discovery refresh is already running; inspect refresh.lock before resuming");
  }
  await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: now.toISOString() }));
  await lockHandle.close();
  try {
    const day = koreanDate(now), month = day.slice(0, 7), runId = now.toISOString().replace(/[:.]/g, "-");
    const previous = await fs2.readFile(root + "/snapshot.json", "utf8").then((raw) => discoverySchema.parse(JSON.parse(raw))).catch(() => null);
    const feed2 = { schemaVersion: 1, updatedAt: previous?.updatedAt ?? now.toISOString(), lastAttemptAt: now.toISOString(), archive: discoverySongs(previous), schedule: { timezone: "Asia/Seoul", hours: [6, 14, 22] }, monthly: previous?.monthly ?? null, top100: previous?.top100 ?? null, errors: [] };
    const client = new TJPublicClient(root + "/request-state.json");
    const rawCatalogue = JSON.parse(await fs2.readFile("data/catalog.json", "utf8"));
    const catalogue = catalogSchema.parse({ ...rawCatalogue, songs: rawCatalogue.songs.map((song) => ({ ...song, registrations: { tj: song.registrations.tj, ky: song.registrations.ky ?? { status: "pending" } } })) });
    const known = new Map(catalogue.songs.map((song) => [song.registrations.tj.number, tjSongSchema.parse({ ...song, registrations: { tj: song.registrations.tj } })]));
    for (const song of discoverySongs(previous)) if (!known.has(song.registrations.tj.number)) known.set(song.registrations.tj.number, song);
    const artists = /* @__PURE__ */ new Map();
    for (const song of catalogue.songs) if (song.localization?.artist === "reviewed" || song.localization?.artist === "official-reading") artists.set(normalize(song.artistOriginal), song.artistKo);
    const curated = JSON.parse(await fs2.readFile("data/curated-search-aliases.json", "utf8"));
    for (const [artist, name] of Object.entries(curated.artists)) artists.set(normalize(artist), String(name));
    const meanings = JSON.parse(await fs2.readFile("data/title-meanings.ko.json", "utf8"));
    const classification = JSON.parse(await fs2.readFile(root + "/classification.json", "utf8").catch(() => "{}"));
    const addError = (part, error) => feed2.errors.push({ part, at: (/* @__PURE__ */ new Date()).toISOString(), message: String(error).slice(0, 350) });
    try {
      await fs2.writeFile(root + "/robots.txt", await client.init());
      await client.request("/chart/top100");
      try {
        const rows2 = parseRows(await client.json("/legacy/api/topAndHot100", { chartType: "TOP", searchStartDate: month + "-01", searchEndDate: day, strType: "3" }), "top100", month);
        const checkedAt = (/* @__PURE__ */ new Date()).toISOString(), evidenceFile = `discovery-chart-${runId}.json`, sourceUrl = "https://www.tjmedia.com/chart/top100";
        await atomicJson(root + "/history/" + evidenceFile, { sourceUrl, checkedAt, parameters: { chartType: "TOP", strType: "3", searchStartDate: month + "-01", searchEndDate: day }, rows: rows2 });
        await atomicJson("data/evidence/" + evidenceFile, { company: "tj", query: `JPOP TOP100 ${month}-01 to ${day}`, url: sourceUrl, checkedAt, httpStatus: 200, scope: "Official website anonymous JPOP chart query, strType=3, chartType=TOP; ranks in requested period", rows: rows2.map(({ number, title, artist }) => ({ number, title, artist })) });
        feed2.top100 = { startDate: month + "-01", endDate: day, checkedAt, sourceUrl, entries: rows2.map((row) => ({ rank: row.rank, song: localizeRow(row, known.get(row.number), artists, meanings, checkedAt, evidenceFile, sourceUrl) })).sort((a, b) => a.rank - b.rank) };
        for (const row of rows2) classification[row.number] = { title: row.title, artist: row.artist, japanese: true, checkedAt, sourceUrl };
      } catch (error) {
        addError("top100", error);
      }
      try {
        const rows2 = parseRows(await client.json("/legacy/api/newSongOfMonth", { searchYm: month.replace("-", "") }), "monthly", month);
        if (rows2.length === 0 && previous?.monthly?.month === month && previous.monthly.totalFetched > 0) throw Error("Unexpected empty current-month response; preserve previous monthly list");
        const checkedAt = (/* @__PURE__ */ new Date()).toISOString(), sourceUrl = "https://www.tjmedia.com/song/recent_song";
        await atomicJson(`${root}/history/discovery-monthly-${runId}.json`, { sourceUrl, checkedAt, parameters: { searchYm: month.replace("-", "") }, rows: rows2 });
        const candidates = rows2.filter((row) => {
          const record = classification[row.number];
          if (record && record.title === row.title && record.artist === row.artist) return false;
          const old = known.get(row.number);
          if (old && normalize(old.artistOriginal) === normalize(row.artist)) {
            classification[row.number] = { title: row.title, artist: row.artist, japanese: true, checkedAt, sourceUrl: old.registrations.tj.sourceUrl };
            return false;
          }
          return true;
        });
        const groups = /* @__PURE__ */ new Map();
        for (const row of candidates) {
          const key = row.number.slice(0, 3);
          groups.set(key, [...groups.get(key) ?? [], row]);
        }
        for (const [query, group] of groups) {
          try {
            let pages = 1;
            const matches = /* @__PURE__ */ new Map();
            let groupUrl = "";
            for (let page = 1; page <= pages; page++) {
              const params = new URLSearchParams({ nationType: "JPN", strType: "16", searchTxt: query, pageRowCnt: "100", pageNo: String(page) });
              groupUrl = "https://www.tjmedia.com/song/accompaniment_search?" + params;
              const result = parseJapaneseSearch(await client.request("/song/accompaniment_search?" + params), query, page);
              if (page > 1 && pages !== result.totalPages) throw Error("JPN page count changed during query");
              pages = result.totalPages;
              for (const row of result.rows) matches.set(row.number, row);
            }
            const matchingRows = group.filter((row) => matches.has(row.number));
            await atomicJson(`${root}/history/${runId}-jpn-${query}.json`, { query, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), sourceUrl: groupUrl, pages, confirmedNumbers: matchingRows.map((row) => row.number), candidateNumbers: group.map((row) => row.number) });
            for (const row of group) classification[row.number] = { title: row.title, artist: row.artist, japanese: matches.has(row.number), checkedAt: (/* @__PURE__ */ new Date()).toISOString(), sourceUrl: groupUrl };
          } catch (error) {
            addError("monthly", error);
            break;
          }
        }
        const japanese = rows2.filter((row) => {
          const record = classification[row.number];
          return record?.japanese && record.title === row.title && record.artist === row.artist;
        });
        const unclassified = rows2.filter((row) => {
          const record = classification[row.number];
          return !record || record.title !== row.title || record.artist !== row.artist;
        });
        const evidenceFile = `discovery-monthly-${runId}.json`;
        await atomicJson("data/evidence/" + evidenceFile, { company: "tj", query: month, url: sourceUrl, checkedAt, httpStatus: 200, scope: "Official monthly new additions; Japanese classification separately verified via official JPN search/chart and classification.json", rows: japanese.map(({ number, title, artist }) => ({ number, title, artist })) });
        feed2.monthly = { month, checkedAt, sourceUrl, totalFetched: rows2.length, unclassifiedCount: unclassified.length, entries: japanese.map((row) => ({ addedOn: row.addedOn, song: localizeRow(row, known.get(row.number), artists, meanings, checkedAt, evidenceFile, sourceUrl) })).sort((a, b) => b.addedOn.localeCompare(a.addedOn)) };
        await atomicJson(root + "/classification.json", classification);
      } catch (error) {
        addError("monthly", error);
      }
    } catch (error) {
      addError("refresh", error);
    }
    const improved = feed2.monthly?.checkedAt !== previous?.monthly?.checkedAt || feed2.top100?.checkedAt !== previous?.top100?.checkedAt;
    if (improved) feed2.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    feed2.archive = discoverySongs(feed2);
    discoverySchema.parse(feed2);
    const report = { at: (/* @__PURE__ */ new Date()).toISOString(), dryRun, requests: client.count, month, monthly: feed2.monthly?.entries.length ?? 0, unclassified: feed2.monthly?.unclassifiedCount ?? 0, top100: feed2.top100?.entries.length ?? 0, errors: feed2.errors };
    if (!dryRun) {
      if (previous) await atomicJson(root + "/history/" + runId + "-before.json", previous);
      await atomicJson(root + "/snapshot.json", feed2);
      await atomicJson("public/discovery.json", feed2);
    }
    await atomicJson(root + "/last-run.json", report);
    console.log(JSON.stringify(report, null, 2));
    if (feed2.errors.length) process.exitCode = 1;
    return feed2;
  } catch (error) {
    await atomicJson(root + "/last-run.json", { at: (/* @__PURE__ */ new Date()).toISOString(), dryRun, errors: [{ part: "refresh", message: String(error).slice(0, 350) }] });
    throw error;
  } finally {
    await fs2.unlink(lock);
  }
}
if (process.argv[1] && path.basename(fileURLToPath(import.meta.url)) === "refresh-discovery.ts" && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await refreshDiscovery({ dryRun: process.argv.includes("--dry-run") });

// scripts/validate-discovery.ts
import fs3 from "node:fs/promises";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
async function validateDiscovery() {
  const feed2 = discoverySchema.parse(JSON.parse(await fs3.readFile("public/discovery.json", "utf8")));
  for (const song of discoverySongs(feed2)) {
    const r = song.registrations.tj;
    const evidence = JSON.parse(await fs3.readFile("data/evidence/" + r.evidenceFile, "utf8"));
    if (evidence.url !== r.sourceUrl || evidence.checkedAt !== r.checkedAt || !evidence.rows.some((row) => row.number === r.number && row.title === r.sourceTitle && row.artist === r.sourceArtist)) throw Error(`Discovery evidence mismatch: ${song.id}`);
  }
  if (feed2.top100) {
    const source2 = JSON.parse(await fs3.readFile("data/discovery/history/" + feed2.top100.entries[0].song.registrations.tj.evidenceFile, "utf8"));
    for (const entry of feed2.top100.entries) if (!source2.rows.some((row) => row.number === entry.song.registrations.tj.number && row.rank === entry.rank)) throw Error("Official chart rank mismatch");
  }
  if (feed2.monthly?.entries.length) {
    const source2 = JSON.parse(await fs3.readFile("data/discovery/history/" + feed2.monthly.entries[0].song.registrations.tj.evidenceFile, "utf8"));
    for (const entry of feed2.monthly.entries) if (!source2.rows.some((row) => row.number === entry.song.registrations.tj.number && row.addedOn === entry.addedOn)) throw Error("Official monthly addition date mismatch");
  }
  console.log(JSON.stringify({ discoveryVerified: true, month: feed2.monthly?.month, monthly: feed2.monthly?.entries.length, top100: feed2.top100?.entries.length, archive: feed2.archive.length, errors: feed2.errors.length }));
  return feed2;
}
if (process.argv[1] && path2.basename(fileURLToPath2(import.meta.url)) === "validate-discovery.ts" && fileURLToPath2(import.meta.url) === path2.resolve(process.argv[1])) await validateDiscovery();

// deploy/cloud-entry.ts
var allowed = (name) => /^(?:data\/(?:catalog\.json|curated-search-aliases\.json|title-meanings\.ko\.json|discovery\/(?:snapshot\.json|classification\.json|request-state\.json|last-run\.json|history\/[a-zA-Z0-9.-]+\.json)|evidence\/[a-zA-Z0-9.-]+\.json)|public\/discovery\.json)$/.test(name);
async function unpack(filename) {
  const files2 = JSON.parse(gunzipSync(await fs4.readFile(filename)).toString("utf8"));
  for (const [name, value] of Object.entries(files2)) {
    if (!allowed(name)) throw Error("Unexpected cloud seed path");
    await atomicJson(name, value);
  }
}
await unpack("seed.json.gz");
await unpack("state.json.gz");
if (!process.argv.includes("--check")) try {
  await refreshDiscovery();
} catch (error) {
  console.error(JSON.stringify({ event: "refresh-failed", message: String(error) }));
  process.exitCode = 1;
}
var feed = await validateDiscovery();
await fs4.mkdir("site", { recursive: true });
await fs4.copyFile("public/discovery.json", "site/discovery.json");
await fs4.writeFile("site/.nojekyll", "");
await fs4.writeFile("site/index.html", '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>\uC6B0\uD0C0\uB118\uBC84 \uB370\uC774\uD130</title><h1>\uC6B0\uD0C0\uB118\uBC84 \uACF5\uAC1C \uB370\uC774\uD130</h1><p>TJ \uC2E0\uADDC \uC77C\uBCF8\uACE1\xB7JPOP TOP100 \uBA54\uD0C0\uB370\uC774\uD130\uB97C \uC81C\uACF5\uD569\uB2C8\uB2E4. TJ\uBBF8\uB514\uC5B4 \uACF5\uC2DD \uC11C\uBE44\uC2A4\uAC00 \uC544\uB2D9\uB2C8\uB2E4.</p><p>\uB85C\uADF8\uC778\xB7\uAC1C\uC778\uC815\uBCF4 \uC218\uC9D1\xB7\uACB0\uC81C\xB7\uC74C\uC6D0\xB7\uAC00\uC0AC\uB294 \uC81C\uACF5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.</p><p><a href="discovery.json">\uCD5C\uC2E0 \uAC80\uC99D \uBAA9\uB85D JSON</a></p><p>\uD55C\uAD6D \uC2DC\uAC04 \uD558\uB8E83\uD68C \uAC31\uC2E0 \uC608\uC57D. \uC81C\uACF5\uC0AC \uAC31\uC2E0 \uC2DC\uC810 \uBC0F \uC790\uB3D9 \uC2E4\uD589 \uC9C0\uC5F0\uC5D0 \uB530\uB77C \uBC18\uC601 \uC2DC\uAC01\uC740 \uB2EC\uB77C\uC9C8 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</p></html>');
var keep = /* @__PURE__ */ new Set(["data/discovery/snapshot.json", "public/discovery.json", "data/discovery/classification.json", "data/discovery/request-state.json", "data/discovery/last-run.json"]);
for (const song of discoverySongs(feed)) keep.add("data/evidence/" + song.registrations.tj.evidenceFile);
for (const list of [feed.monthly, feed.top100]) if (list?.entries.length) keep.add("data/discovery/history/" + list.entries[0].song.registrations.tj.evidenceFile);
var files = {};
for (const name of keep) {
  if (!allowed(name)) throw Error("Unexpected output state path");
  try {
    files[name] = JSON.parse(await fs4.readFile(name, "utf8"));
  } catch (error) {
    if (["data/discovery/request-state.json", "data/discovery/last-run.json"].includes(name)) continue;
    throw error;
  }
}
await fs4.writeFile("state.json.gz", gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 }));
console.log(JSON.stringify({ siteReady: true, month: feed.monthly?.month, monthly: feed.monthly?.entries.length, top100: feed.top100?.entries.length, errors: feed.errors.length }));
