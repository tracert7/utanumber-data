// deploy/cloud-health-entry.ts
import fs from "node:fs/promises";

// src/discovery.ts
import { z as z2 } from "zod";

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
}).strict().superRefine((feed, ctx) => {
  const issue = (message) => ctx.addIssue({ code: "custom", message });
  const monthlyIds = /* @__PURE__ */ new Set();
  for (const entry of feed.monthly?.entries ?? []) {
    if (entry.addedOn.slice(0, 7) !== feed.monthly.month) issue("Month mismatch");
    if (monthlyIds.has(entry.song.id)) issue("Duplicate monthly song");
    monthlyIds.add(entry.song.id);
  }
  const ranks = /* @__PURE__ */ new Set(), chartIds = /* @__PURE__ */ new Set();
  for (const entry of feed.top100?.entries ?? []) {
    if (ranks.has(entry.rank) || chartIds.has(entry.song.id)) issue("Duplicate chart rank/song");
    ranks.add(entry.rank);
    chartIds.add(entry.song.id);
  }
  if (feed.top100 && feed.top100.startDate > feed.top100.endDate) issue("Invalid chart period");
  const numbers = /* @__PURE__ */ new Map(), ids = /* @__PURE__ */ new Map();
  for (const song of [...feed.archive, ...feed.monthly?.entries.map((e) => e.song) ?? [], ...feed.top100?.entries.map((e) => e.song) ?? []]) {
    const number = song.registrations.tj.number;
    if (song.registrations.tj.status !== "registered") issue("Unverified discovery number");
    if (numbers.has(number) && numbers.get(number) !== song.id || ids.has(song.id) && ids.get(song.id) !== number) issue("Discovery identity conflict");
    numbers.set(number, song.id);
    ids.set(song.id, number);
  }
});
var staleDiscovery = (checkedAt, now = Date.now()) => now - Date.parse(checkedAt) > 12 * 36e5;

// scripts/lib/cloud-health.ts
var cloudEndpoint = "https://tracert7.github.io/utanumber-data/discovery.json";
function inspectCloudFeed(input, now = Date.now()) {
  const feed = discoverySchema.parse(input);
  const reasons = [];
  if (!feed.monthly) reasons.push("missing-monthly");
  if (!feed.top100) reasons.push("missing-top100");
  if (feed.errors.length) reasons.push("source-errors");
  for (const [name, stamp2] of [
    ["feed", feed.updatedAt],
    ["monthly", feed.monthly?.checkedAt],
    ["chart", feed.top100?.checkedAt]
  ]) {
    if (stamp2 && staleDiscovery(stamp2, now)) reasons.push(`stale-${name}`);
    if (stamp2 && Date.parse(stamp2) > now + 5 * 6e4) reasons.push(`future-${name}`);
  }
  if (feed.monthly?.unclassifiedCount) reasons.push("unclassified-monthly");
  return {
    healthy: reasons.length === 0,
    updatedAt: feed.updatedAt,
    monthly: feed.monthly?.entries.length ?? 0,
    top100: feed.top100?.entries.length ?? 0,
    monthlyCheckedAt: feed.monthly?.checkedAt,
    chartCheckedAt: feed.top100?.checkedAt,
    reasons,
    errors: feed.errors
  };
}
async function checkCloud(options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const base = () => ({ checkedAt: new Date(now()).toISOString(), endpoint: cloudEndpoint });
  for (let attempts = 1; attempts <= 3; attempts++) {
    let response;
    try {
      response = await fetcher(cloudEndpoint, { cache: "no-store", signal: AbortSignal.timeout(25e3) });
    } catch (error) {
      if (attempts < 3) {
        await wait(2e3 * attempts);
        continue;
      }
      const cause = error?.cause?.code;
      return { ...base(), healthy: false, attempts, reasons: ["connection-failed"], transportError: cause ?? (error instanceof Error ? error.name : "UnknownError") };
    }
    if (!response.ok) {
      if (response.status >= 500 && attempts < 3) {
        await wait(2e3 * attempts);
        continue;
      }
      return { ...base(), healthy: false, attempts, reasons: [`http-${response.status}`] };
    }
    const reasons = [];
    if (!response.headers.get("content-type")?.includes("application/json")) reasons.push("invalid-content-type");
    if (response.headers.get("access-control-allow-origin") !== "*") reasons.push("missing-public-cors");
    try {
      const inspected = inspectCloudFeed(await response.json(), now());
      return { ...base(), ...inspected, attempts, healthy: inspected.healthy && !reasons.length, reasons: [...reasons, ...inspected.reasons] };
    } catch {
      return { ...base(), healthy: false, attempts, reasons: [...reasons, "invalid-schema-or-json"] };
    }
  }
  throw new Error("Unreachable retry state");
}

// deploy/cloud-health-entry.ts
var report = await checkCloud();
await fs.mkdir(".health", { recursive: true });
await fs.writeFile(".health/cloud-health.json", JSON.stringify(report, null, 2) + "\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "# UtaNumber public data health",
    "",
    `- Result: ${report.healthy ? "PASS" : "FAIL"}`,
    `- Checked: ${report.checkedAt}`,
    `- Data updated: ${report.updatedAt ?? "unavailable"}`,
    `- Monthly songs: ${report.monthly ?? "unavailable"}`,
    `- JPOP TOP100: ${report.top100 ?? "unavailable"}`,
    `- Reasons: ${report.reasons.join(", ") || "none"}`,
    "",
    "Read-only public JSON check. No TJ collection or data publishing.",
    ""
  ].join("\n"));
}
console.log(JSON.stringify(report, null, 2));
if (!report.healthy) process.exitCode = 1;
