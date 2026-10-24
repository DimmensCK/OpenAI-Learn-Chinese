#!/usr/bin/env node
// Run with Node.js 22+: node scripts/validate.mjs [--root <package-directory>]
// Update this baseline deliberately when publishing a new content snapshot.
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE = Object.freeze({
  version: 'V6',
  snapshot: '2026-10-21',
  availableArticles: 322,
  unavailableArticles: 9,
  glossaryTerms: 325,
  launcherSha256: '05c6191138287f4462f512197a09f14dd9347131ca7053f0e54f9bdbdde359a7',
});
const DATA = '学习资料';
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// This reader accepts only the fixed data-assignment envelopes used by this
// package. It never evaluates JavaScript. A small string/container scanner finds
// JSON boundaries, and JSON.parse validates the complete enclosed value.
class DataReader {
  constructor(source, label) {
    this.source = source;
    this.label = label;
    this.offset = 0;
  }

  fail(message) {
    throw new Error(`${this.label}: ${message} at offset ${this.offset}`);
  }

  whitespace() {
    while (' \t\r\n'.includes(this.source[this.offset]) && this.offset < this.source.length) {
      this.offset += 1;
    }
  }

  token(expected) {
    this.whitespace();
    if (!this.source.startsWith(expected, this.offset)) this.fail(`expected ${expected}`);
    this.offset += expected.length;
  }

  json() {
    this.whitespace();
    const start = this.offset;
    const first = this.source[start];
    if (first !== '"' && first !== '{' && first !== '[') this.fail('expected JSON string or container');
    const stack = [];
    let quoted = false;
    let escaped = false;
    let finished = false;
    for (; this.offset < this.source.length; this.offset += 1) {
      const character = this.source[this.offset];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') {
          quoted = false;
          if (stack.length === 0) { this.offset += 1; finished = true; break; }
        }
      } else if (character === '"') quoted = true;
      else if (character === '{' || character === '[') stack.push(character);
      else if (character === '}' || character === ']') {
        const opening = stack.pop();
        if (opening !== (character === '}' ? '{' : '[')) this.fail('unbalanced JSON container');
        if (stack.length === 0) { this.offset += 1; finished = true; break; }
      }
    }
    if (!finished) this.fail('unterminated JSON value');
    try { return JSON.parse(this.source.slice(start, this.offset)); }
    catch { this.fail('invalid JSON'); }
  }

  end() {
    this.whitespace();
    if (this.offset !== this.source.length) this.fail('unexpected trailing content');
  }
}

function readCatalog(source, label) {
  const reader = new DataReader(source, label);
  for (const token of ['window', '.', 'LEARN', '=']) reader.token(token);
  const value = reader.json();
  reader.token(';');
  reader.end();
  requireValue(isObject(value), `${label}: catalog must be an object`);
  return value;
}

function readPayload(source, expectedId, label) {
  const reader = new DataReader(source, label);
  for (const token of ['window', '.', 'LEARN_CONTENT', '=', 'window', '.', 'LEARN_CONTENT', '||', '{', '}', ';', 'window', '.', 'LEARN_CONTENT', '[']) {
    reader.token(token);
  }
  requireValue(reader.json() === expectedId, `${label}: assignment ID does not match the catalog`);
  reader.token(']');
  reader.token('=');
  const value = reader.json();
  reader.token(';');
  reader.end();
  requireValue(isObject(value), `${label}: payload must be an object`);
  requireValue(Object.keys(value).length === 2 && Object.hasOwn(value, 'zh') && Object.hasOwn(value, 'en'), `${label}: expected exactly zh and en fields`);
  requireValue(typeof value.zh === 'string' && typeof value.en === 'string', `${label}: zh and en must be strings`);
  return value;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function validate(rootArgument) {
  let root;
  try { root = await realpath(rootArgument); }
  catch (error) { throw new Error(`package root is unavailable (${error.code || 'IO_ERROR'})`); }

  const rootEntries = await readdir(root, { withFileTypes: true });
  const rootFiles = rootEntries.filter(entry => entry.isFile()).map(entry => entry.name).sort();
  requireValue(rootFiles.length === 1 && rootFiles[0] === '开始学习.cmd', 'package root must contain only 开始学习.cmd as a regular file; put documentation and maintenance files in subdirectories');
  requireValue(rootEntries.every(entry => entry.isFile() || entry.isDirectory()), 'package root must not contain symbolic links or special entries');

  async function checkedPath(relative, kind = 'file') {
    requireValue(typeof relative === 'string' && relative.length > 0, 'empty package path');
    requireValue(!path.isAbsolute(relative) && !/[\\:\0]/u.test(relative), `invalid package path: ${relative}`);
    const parts = relative.split('/');
    requireValue(parts.every(part => part && part !== '.' && part !== '..'), `unsafe package path: ${relative}`);
    const absolute = path.resolve(root, ...parts);
    requireValue(isInside(root, absolute), `path leaves package: ${relative}`);
    let current = root;
    let entry;
    try {
      for (const part of parts) {
        current = path.join(current, part);
        entry = await lstat(current);
        requireValue(!entry.isSymbolicLink(), `symbolic links are not allowed: ${relative}`);
      }
      requireValue(isInside(root, await realpath(absolute)), `resolved path leaves package: ${relative}`);
    } catch (error) {
      if (error.code) throw new Error(`${relative}: unavailable (${error.code})`);
      throw error;
    }
    requireValue(kind === 'directory' ? entry.isDirectory() : entry.isFile(), `${relative}: expected ${kind}`);
    return { absolute, size: entry.size };
  }

  async function textFile(relative) {
    const { absolute, size } = await checkedPath(relative);
    requireValue(size > 0 && size <= MAX_FILE_BYTES, `${relative}: empty or exceeds 32 MiB limit`);
    try { return decoder.decode(await readFile(absolute)); }
    catch (error) { throw new Error(`${relative}: cannot read valid UTF-8 (${error.code || 'DECODE_ERROR'})`); }
  }

  const required = ['开始学习.cmd', `${DATA}/index.html`, `${DATA}/app.js`, `${DATA}/app.css`, `${DATA}/catalog.js`, `${DATA}/使用说明.md`, `${DATA}/来源与权利说明.md`];
  for (const relative of required) await checkedPath(relative);
  const launcher = await textFile('开始学习.cmd');
  requireValue(launcher.includes('set "LEARN_ENTRY=%~dp0学习资料\\index.html"') && launcher.includes('start "" "%LEARN_ENTRY%"'), 'launcher must open the relative learning entry');
  let launcherBytes;
  try { launcherBytes = await readFile((await checkedPath('开始学习.cmd')).absolute); }
  catch { throw new Error('cannot read launcher bytes for SHA-256 validation'); }
  const launcherSha256 = createHash('sha256').update(launcherBytes).digest('hex');
  requireValue(launcherSha256 === BASELINE.launcherSha256, '开始学习.cmd SHA-256 differs from the supplied launcher; restore its original bytes, including line endings. The validator does not normalize files.');

  const catalog = readCatalog(await textFile(`${DATA}/catalog.js`), `${DATA}/catalog.js`);
  requireValue(isObject(catalog.meta), 'catalog.meta must be an object');
  requireValue(catalog.meta.version === BASELINE.version, 'catalog version differs from baseline');
  requireValue(catalog.meta.snapshot === BASELINE.snapshot, 'catalog snapshot differs from baseline');
  for (const key of ['articles', 'glossary', 'sections']) requireValue(Array.isArray(catalog[key]), `catalog.${key} must be an array`);
  const counts = {
    availableArticles: catalog.articles.filter(item => item?.status === 'available').length,
    unavailableArticles: catalog.articles.filter(item => item?.status === 'unavailable').length,
    glossaryTerms: catalog.glossary.length,
  };
  for (const key of Object.keys(counts)) requireValue(counts[key] === BASELINE[key], `${key} differs from baseline: ${counts[key]} != ${BASELINE[key]}`);
  requireValue(catalog.articles.length === counts.availableArticles + counts.unavailableArticles, 'article has an unsupported status');
  for (const [key, expected] of [['articleCount', counts.availableArticles], ['unavailableCount', counts.unavailableArticles], ['glossaryCount', counts.glossaryTerms]]) {
    requireValue(catalog.meta[key] === expected, `catalog.meta.${key} disagrees with records`);
  }

  const allIds = new Set();
  function recordIds(records, idPattern, label) {
    const ids = new Set();
    for (const item of records) {
      requireValue(isObject(item) && typeof item.id === 'string' && idPattern.test(item.id), `${label}: invalid or unsafe ID`);
      requireValue(!allIds.has(item.id), `${label}: duplicate ID ${item.id}`);
      requireValue(hasText(item.title), `${label}/${item.id}: missing title`);
      ids.add(item.id);
      allIds.add(item.id);
    }
    return ids;
  }
  recordIds(catalog.articles, /^a-[0-9a-f]{16}$/u, 'articles');
  const glossaryIds = recordIds(catalog.glossary, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'glossary');
  const sectionIds = recordIds(catalog.sections, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'sections');
  for (const article of catalog.articles) {
    let source;
    try { source = new URL(article.url); }
    catch { throw new Error(`articles/${article.id}: invalid official source URL`); }
    requireValue(source.protocol === 'https:' && source.hostname === 'learn.chatgpt.com' && !source.port && !source.username && !source.password, `articles/${article.id}: source must be HTTPS learn.chatgpt.com`);
    requireValue(sectionIds.has(article.section), `articles/${article.id}: unknown section`);
    requireValue(Array.isArray(article.terms), `articles/${article.id}: terms must be an array`);
    for (const termId of article.terms) requireValue(glossaryIds.has(termId), `articles/${article.id}: unknown glossary reference`);
  }

  async function payloads(folder, records, needsEnglish) {
    const relativeDirectory = `${DATA}/${folder}`;
    const { absolute } = await checkedPath(relativeDirectory, 'directory');
    let entries;
    try { entries = await readdir(absolute, { withFileTypes: true }); }
    catch (error) { throw new Error(`${relativeDirectory}: cannot list (${error.code || 'IO_ERROR'})`); }
    const expectedNames = new Set(records.map(item => `${item.id}.js`));
    requireValue(entries.length === expectedNames.size, `${relativeDirectory}: payload file count differs from catalog`);
    for (const entry of entries) requireValue(entry.isFile() && expectedNames.has(entry.name), `${relativeDirectory}: unexpected entry ${entry.name}`);
    for (const item of records) {
      const relative = `${relativeDirectory}/${item.id}.js`;
      const payload = readPayload(await textFile(relative), item.id, relative);
      requireValue(hasText(payload.zh), `${relative}: empty Chinese payload`);
      if (needsEnglish) requireValue(hasText(payload.en), `${relative}: empty English payload`);
    }
  }
  await payloads('pages', catalog.articles.filter(item => item.status === 'available'), true);
  await payloads('glossary', catalog.glossary, false);

  const index = await textFile(`${DATA}/index.html`);
  const activeIndex = index.replace(/<!--[\s\S]*?-->/gu, '');
  requireValue(!activeIndex.includes('<!--'), 'index.html: unterminated HTML comment');
  requireValue(!/<base\b/iu.test(activeIndex), 'index.html: base elements are not allowed in the relative offline entry');
  const resources = new Set();
  const entryScripts = new Set();
  const entryStylesheets = new Set();
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;
  for (const tag of activeIndex.matchAll(/<(script|link|img|source|iframe|audio|video)\b([^>]*)>/giu)) {
    const attributes = new Map();
    for (const attribute of tag[2].matchAll(attributePattern)) {
      const name = attribute[1].toLowerCase();
      requireValue(!attributes.has(name), `index.html: duplicate ${name} attribute`);
      attributes.set(name, attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    const tagName = tag[1].toLowerCase();
    const resource = attributes.get(tagName === 'link' ? 'href' : 'src');
    if (resource === undefined) {
      requireValue(tagName !== 'script' && tagName !== 'link', `index.html: ${tagName} resource is missing`);
      continue;
    }
    if (tagName === 'link' && attributes.get('rel') === 'icon' && resource === 'data:,') continue;
    requireValue(resource.length > 0 && !resource.startsWith('/') && !/[\\:]/u.test(resource), 'index.html: resources must use package-relative paths');
    let clean;
    try { clean = decodeURIComponent(resource.split(/[?#]/u)[0]); }
    catch { throw new Error('index.html: invalid resource URL encoding'); }
    await checkedPath(`${DATA}/${clean}`);
    resources.add(clean);
    if (tagName === 'script') entryScripts.add(clean);
    if (tagName === 'link' && attributes.get('rel')?.toLowerCase().split(/\s+/u).includes('stylesheet')) entryStylesheets.add(clean);
  }
  requireValue(entryStylesheets.has('app.css'), 'index.html: missing app.css stylesheet reference');
  for (const requiredScript of ['catalog.js', 'app.js']) requireValue(entryScripts.has(requiredScript), `index.html: missing ${requiredScript} script reference`);

  return {
    ok: true,
    rootFiles,
    launcherSha256,
    baseline: BASELINE,
    counts: { ...counts, bilingualArticles: counts.availableArticles, payloadFiles: counts.availableArticles + counts.glossaryTerms },
    relativeEntryResources: [...resources].sort(),
    checks: ['root-layout', 'launcher-exact-bytes', 'fixed-data-syntax', 'unique-ids', 'https-learn-article-sources', 'catalog-payload-set', 'bilingual-articles', 'glossary-references', 'contained-paths', 'relative-entry-resources'],
  };
}

try {
  requireValue(Number(process.versions.node.split('.')[0]) >= 22, 'Node.js 22 or newer is required');
  const argumentsList = process.argv.slice(2);
  requireValue(argumentsList.length === 0 || (argumentsList.length === 2 && argumentsList[0] === '--root' && argumentsList[1]), 'usage: node scripts/validate.mjs [--root <package-directory>]');
  const root = argumentsList.length ? path.resolve(argumentsList[1]) : fileURLToPath(new URL('../', import.meta.url));
  console.log(JSON.stringify(await validate(root)));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
