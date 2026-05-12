#!/usr/bin/env node
/**
 * upload-configurator-files.mjs
 *
 * Uploads boot-configurator image assets from theme `assets/` to Shopify Files
 * via the Admin GraphQL API. Emits a filename → CDN URL manifest.
 *
 * Modes:
 *   --pilot        Upload only the 5 pilot files (writes pilot manifest).
 *   --dry-run      Print actions without uploading.
 *
 * Reads creds from <repo-root>/.env: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ACCESS_TOKEN,
 * SHOPIFY_API_VERSION (optional, defaults to 2025-01).
 *
 * Node 20+ required (native fetch + FormData + Blob).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const ASSETS_DIR = resolve(REPO_ROOT, 'assets');
const SCRIPTS_DIR = resolve(REPO_ROOT, 'scripts');
const MANIFEST_FULL = resolve(SCRIPTS_DIR, 'configurator-files-manifest.json');
const MANIFEST_PILOT = resolve(SCRIPTS_DIR, 'configurator-files-manifest.pilot.json');
const FAILED_LOG = resolve(SCRIPTS_DIR, '.failed-uploads.json');

const PILOT_FILES = [
  'configurator-body.png',
  'configurator-toe-round.png',
  'configurator-elastic-black.svg',
  'configurator-leather-chestnut.png',
  'configurator-boot-round-flat-leather-chestnut-brown-red.png',
];

const CONCURRENCY = 6;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60000;
const MAX_THROTTLE_RETRIES = 8;

// ─── env loader ──────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) die(`Missing .env at ${envPath}`);
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  for (const k of ['SHOPIFY_SHOP_DOMAIN', 'SHOPIFY_ACCESS_TOKEN']) {
    if (!env[k]) die(`Missing ${k} in .env`);
  }
  env.SHOPIFY_API_VERSION ??= '2025-01';
  return env;
}

// ─── logging ─────────────────────────────────────────────────────────────
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);
const err = (...a) => console.error(`[${ts()}] ✗`, ...a);
function die(msg) { err(msg); process.exit(1); }

// ─── mime ────────────────────────────────────────────────────────────────
function mimeFor(filename) {
  const e = extname(filename).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.svg') return 'image/svg+xml';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

// ─── GraphQL client (with throttle handling) ─────────────────────────────
function makeClient(env) {
  const url = `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`;
  const headers = {
    'X-Shopify-Access-Token': env.SHOPIFY_ACCESS_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  return async function gql(query, variables = {}, attempt = 0) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
    }
    const json = await res.json();
    // Throttle handling
    const throttled = (json.errors || []).some(e => e?.extensions?.code === 'THROTTLED');
    if (throttled && attempt < MAX_THROTTLE_RETRIES) {
      const cost = json.extensions?.cost?.throttleStatus;
      const wait = cost
        ? Math.max(1000, Math.ceil((cost.maximumAvailable - cost.currentlyAvailable) / Math.max(cost.restoreRate, 1)) * 1000)
        : 2000 * 2 ** attempt;
      warn(`Throttled — backing off ${(wait / 1000).toFixed(1)}s`);
      await sleep(wait);
      return gql(query, variables, attempt + 1);
    }
    if (json.errors) {
      throw new Error(`GraphQL: ${JSON.stringify(json.errors).slice(0, 800)}`);
    }
    return json.data;
  };
}

// ─── scope/auth validation ───────────────────────────────────────────────
async function validateAuth(gql) {
  const data = await gql(`{ files(first: 1) { edges { node { id } } } }`);
  if (!data || !('files' in data)) die('Token lacks read_files scope (or shop unreachable).');
  // Write-side probe: stagedUploadsCreate with zero-byte image is the cleanest
  // way to check write_files without actually uploading. We do a 1-byte probe.
  // Skip the write probe — fileCreate failures will surface clearly anyway.
  log('Auth OK (read_files confirmed).');
}

// ─── existing Files listing (collision pre-check) ────────────────────────
async function listExistingConfiguratorFiles(gql) {
  const seen = new Map(); // filename → url
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const data = await gql(
      `query($c: String) { files(first: 250, after: $c, query: "filename:configurator-*") { pageInfo { hasNextPage endCursor } edges { node { id alt ... on MediaImage { image { url } } ... on GenericFile { url } } } } }`,
      { c: cursor }
    );
    for (const { node } of data.files.edges) {
      const url = node.image?.url || node.url;
      if (!url) continue;
      const name = decodeURIComponent(basename(new URL(url).pathname).split('?')[0]);
      seen.set(name, url);
    }
    if (!data.files.pageInfo.hasNextPage) break;
    cursor = data.files.pageInfo.endCursor;
  }
  return seen;
}

// ─── per-file upload pipeline ────────────────────────────────────────────
async function stagedUploadCreate(gql, filename, mimeType, fileSize) {
  const data = await gql(
    `mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: [{
        resource: 'FILE',
        filename,
        mimeType,
        fileSize: String(fileSize),
        httpMethod: 'POST',
      }],
    }
  );
  const out = data.stagedUploadsCreate;
  if (out.userErrors?.length) throw new Error(`stagedUploadsCreate: ${JSON.stringify(out.userErrors)}`);
  if (!out.stagedTargets?.[0]) throw new Error('No staged target returned');
  return out.stagedTargets[0];
}

async function uploadToStagedTarget(target, fileBuffer, filename, mimeType) {
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    const body = await res.text().catch(() => '');
    throw new Error(`Staged upload HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function fileCreate(gql, filename, resourceUrl, mimeType) {
  const isSvg = mimeType === 'image/svg+xml';
  const contentType = isSvg ? 'FILE' : 'IMAGE';
  const data = await gql(
    `mutation($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          alt
          ... on MediaImage { image { url } }
          ... on GenericFile { url }
        }
        userErrors { field message code }
      }
    }`,
    {
      files: [{
        originalSource: resourceUrl,
        contentType,
        filename,
      }],
    }
  );
  const out = data.fileCreate;
  if (out.userErrors?.length) {
    throw new Error(`fileCreate: ${JSON.stringify(out.userErrors)}`);
  }
  if (!out.files?.[0]) throw new Error('No file returned from fileCreate');
  return out.files[0];
}

async function pollUntilReady(gql, fileId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const data = await gql(
      `query($id: ID!) {
        node(id: $id) {
          id
          ... on MediaImage { fileStatus image { url } alt }
          ... on GenericFile { fileStatus url alt }
        }
      }`,
      { id: fileId }
    );
    const n = data.node;
    if (!n) throw new Error(`File ${fileId} not found`);
    if (n.fileStatus === 'READY') {
      const url = n.image?.url || n.url;
      if (!url) throw new Error(`File ${fileId} READY but no URL field`);
      return url;
    }
    if (n.fileStatus === 'FAILED') throw new Error(`File ${fileId} FAILED upload processing`);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`File ${fileId} timed out waiting for READY`);
}

async function uploadOne(gql, filename) {
  const filePath = resolve(ASSETS_DIR, filename);
  const fileBuffer = readFileSync(filePath);
  const mimeType = mimeFor(filename);
  const fileSize = statSync(filePath).size;

  const target = await stagedUploadCreate(gql, filename, mimeType, fileSize);
  await uploadToStagedTarget(target, fileBuffer, filename, mimeType);
  const created = await fileCreate(gql, filename, target.resourceUrl, mimeType);
  let url = created.image?.url || created.url;
  if (!url || created.fileStatus !== 'READY') {
    url = await pollUntilReady(gql, created.id);
  }
  return url;
}

// ─── concurrency-limited batch runner ────────────────────────────────────
async function runBatch(items, fn, concurrency = CONCURRENCY, onProgress) {
  const results = { ok: {}, fail: {} };
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      try {
        const result = await fn(item);
        results.ok[item] = result;
      } catch (e) {
        results.fail[item] = String(e?.message || e);
      }
      completed++;
      if (onProgress) onProgress(completed, items.length, item);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── manifest helpers ────────────────────────────────────────────────────
function loadManifest(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeManifest(path, shop, ok, fail) {
  const manifest = {
    generated_at: new Date().toISOString(),
    shop,
    uploaded: Object.keys(ok).length,
    failed_count: Object.keys(fail).length,
    failed: fail,
    files: ok,
  };
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  const args = new Set(process.argv.slice(2));
  const isPilot = args.has('--pilot');
  const isDry = args.has('--dry-run');

  const env = loadEnv();
  log(`Shop: ${env.SHOPIFY_SHOP_DOMAIN}  API: ${env.SHOPIFY_API_VERSION}  Mode: ${isPilot ? 'PILOT (5 files)' : 'FULL'}${isDry ? ' [DRY-RUN]' : ''}`);

  const gql = makeClient(env);
  await validateAuth(gql);

  // Gather local files
  let candidates;
  if (isPilot) {
    candidates = PILOT_FILES.slice();
    for (const f of candidates) {
      if (!existsSync(resolve(ASSETS_DIR, f))) die(`Pilot file missing: ${f}`);
    }
  } else {
    candidates = readdirSync(ASSETS_DIR)
      .filter(n => /^configurator-/.test(n) && /\.(png|svg)$/i.test(n))
      .sort();
  }
  log(`Local candidates: ${candidates.length}`);

  // Skip files already in manifest (resume support)
  const manifestPath = isPilot ? MANIFEST_PILOT : MANIFEST_FULL;
  const prior = loadManifest(manifestPath);
  let priorFiles = prior?.files || {};
  // Also fold pilot manifest into the full run so the 5 pilot files aren't re-uploaded
  if (!isPilot) {
    const pilotPrior = loadManifest(MANIFEST_PILOT);
    if (pilotPrior?.files) priorFiles = { ...pilotPrior.files, ...priorFiles };
  }
  const toUpload = candidates.filter(f => !priorFiles[f]);
  const skipped = candidates.length - toUpload.length;
  if (skipped) log(`Skipping ${skipped} file(s) already in manifest.`);

  // Pre-check Shopify Files for collisions
  log('Querying Shopify Files for existing configurator-* entries…');
  const existing = await listExistingConfiguratorFiles(gql);
  log(`Found ${existing.size} existing configurator-* files in Shopify Files.`);

  // Reconcile existing Files entries with the manifest: if a file exists in Files
  // but not in our manifest, we either (a) already have it under another manifest
  // run, or (b) it's a stale upload. For pilot/full: skip uploading collisions and
  // adopt their URLs into the results map (preserve filenames).
  const adopted = {};
  const blockedCollisions = [];
  for (const f of toUpload) {
    if (existing.has(f)) {
      // Verify filename matches exactly (no _1, _2 suffix)
      adopted[f] = existing.get(f);
    }
  }
  // Identify any name-prefix collisions (foo_1.png variants of our target names)
  for (const [name] of existing.entries()) {
    for (const target of toUpload) {
      if (name !== target && name.startsWith(target.replace(/\.[a-z]+$/i, '')) && /\d+\.[a-z]+$/i.test(name)) {
        blockedCollisions.push({ collidesWith: target, existingName: name });
      }
    }
  }
  if (blockedCollisions.length) {
    err('Filename collisions detected (Shopify renamed prior uploads). Clear these in Admin → Content → Files before continuing:');
    for (const c of blockedCollisions.slice(0, 20)) err(`  ${c.existingName}  (would collide with ${c.collidesWith})`);
    if (blockedCollisions.length > 20) err(`  …and ${blockedCollisions.length - 20} more`);
    process.exit(2);
  }

  const finalToUpload = toUpload.filter(f => !adopted[f]);
  log(`To upload: ${finalToUpload.length}  Adopted existing: ${Object.keys(adopted).length}`);

  if (isDry) {
    log('[DRY-RUN] would upload:');
    for (const f of finalToUpload.slice(0, 20)) log('  ', f);
    if (finalToUpload.length > 20) log(`   …and ${finalToUpload.length - 20} more`);
    return;
  }

  // Upload
  log(`Uploading ${finalToUpload.length} file(s) with concurrency ${CONCURRENCY}…`);
  const t0 = Date.now();
  const results = await runBatch(
    finalToUpload,
    (f) => uploadOne(gql, f),
    CONCURRENCY,
    (done, total, last) => {
      if (done % 10 === 0 || done === total) {
        log(`  ${done}/${total}  (just finished ${last})`);
      }
    }
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`Upload phase done in ${elapsed}s.  OK=${Object.keys(results.ok).length}  FAIL=${Object.keys(results.fail).length}`);

  // Merge adopted + prior + ok into final manifest
  const allOk = { ...priorFiles, ...adopted, ...results.ok };
  writeManifest(manifestPath, env.SHOPIFY_SHOP_DOMAIN, allOk, results.fail);
  log(`Manifest: ${manifestPath}  (${Object.keys(allOk).length} entries)`);

  // Persist failure log if any
  if (Object.keys(results.fail).length) {
    writeFileSync(FAILED_LOG, JSON.stringify(results.fail, null, 2));
    err(`${Object.keys(results.fail).length} failure(s) written to ${FAILED_LOG}`);
    for (const [f, msg] of Object.entries(results.fail).slice(0, 10)) err(`  ${f}: ${msg.slice(0, 200)}`);
    process.exit(3);
  }

  // Print 10 random URLs for spot-curl verification
  const entries = Object.entries(allOk);
  const sample = [];
  while (sample.length < Math.min(10, entries.length)) {
    const pick = entries[Math.floor(Math.random() * entries.length)];
    if (!sample.find(s => s[0] === pick[0])) sample.push(pick);
  }
  log('Spot-check URLs (curl -I to verify 200):');
  for (const [name, url] of sample) log(`  ${name}\n    ${url}`);
}

main().catch(e => { err(e?.stack || e?.message || e); process.exit(1); });
