// Builds use_figma-ready scripts that run the plugin's production code (controller, audit,
// navigation, design-system references, capture) inside a real Figma file.
//
// use_figma accepts at most 50,000 characters per call, and the bundle is larger than that. So the
// bundle is split into parts, each installed by its own call as shared plugin data on a test host
// (a page node on a test page):
//   install-<host>-<i>of<n>.generated.js   stores part i (checksummed) on that node
//   <scenario>.generated.js                joins the parts, verifies the whole bundle's checksum,
//                                          then runs the scenario
// Scenarios declare their host on their first line: `// @host 45:2`.
// A scenario may inline a JSON file produced by an earlier scenario with `__JSON(name.json)__`
// (e.g. a design system captured in the library file, then used in a consuming file).
// Errors and warnings the plugin code logs are collected in `__logged` for scenarios to return.
//   node dev/e2e/build.mjs
import * as esbuild from 'esbuild';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

await esbuild.build({
  entryPoints: ['dev/figma-e2e.ts'], bundle: true, minify: true, target: 'es2017', format: 'iife',
  outfile: 'dev/figma-e2e.js', logLevel: 'warning', charset: 'utf8',
});
const src = readFileSync('dev/figma-e2e.js', 'utf8');
const checksum = (s) => {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) >>> 0;
  return sum;
};
const sum = checksum(src);
const LIMIT = 50000;
const PART_CHARS = 30000; // leaves room for JSON escaping and the install wrapper
const NS = 'dsd_e2e';
const checksumJs = (v) => `let sum = 0; for (let i = 0; i < ${v}.length; i++) sum = (sum * 31 + ${v}.charCodeAt(i)) >>> 0;\n`;

const parts = [];
for (let i = 0; i < src.length; i += PART_CHARS) parts.push(src.slice(i, i + PART_CHARS));
const n = parts.length;
const hostFile = (host) => host.replace(':', '-');

// Old single-part install scripts would install a bundle no scenario can load any more.
for (const f of readdirSync('dev/e2e')) if (/^install-.*\.generated\.js$/.test(f)) rmSync(`dev/e2e/${f}`);

const inlineJson = (body, file) =>
  body.replace(/__JSON\(([\w.-]+)\)__/g, (_m, name) => {
    const path = `dev/e2e/${name}`;
    if (!existsSync(path)) throw new Error(`${file}: ${name} not found; run the scenario that produces it first`);
    return JSON.stringify(JSON.parse(readFileSync(path, 'utf8')));
  });

const scenarios = readdirSync('dev/e2e').filter((f) => f.endsWith('.js') && !f.endsWith('.generated.js'));
const hosts = new Set();
const skipped = [];
for (const file of scenarios) {
  const raw = readFileSync(`dev/e2e/${file}`, 'utf8');
  const host = raw.match(/^\/\/ @host (\S+)/)?.[1];
  if (!host) throw new Error(`${file}: first line must be "// @host <nodeId>"`);
  hosts.add(host);
  let body;
  try {
    body = inlineJson(raw, file);
  } catch (e) {
    skipped.push(`${file} (${e.message.split(': ')[1]})`);
    continue;
  }
  const out =
    `const __host = await figma.getNodeByIdAsync('${host}');\n` +
    `const SRC = __host ? Array.from({ length: ${n} }, (_, i) => __host.getSharedPluginData('${NS}', 'bundle.' + i)).join('') : '';\n` +
    checksumJs('SRC') +
    `if (SRC.length !== ${src.length} || sum !== ${sum}) throw new Error('Bundle ${sum} is not installed on ${host}: run install-${hostFile(host)}-1of${n} … ${n}of${n}.generated.js first');\n` +
    // The bundle gets its own console: use_figma's is read-only, and this records everything the
    // plugin code logs as an error or warning so scenarios can report it (\`__logged\`).
    `const __logged = [];\n` +
    `const __console = { log() {}, info() {}, debug() {}, warn: (...a) => void __logged.push('warn: ' + a.map(String).join(' ')), error: (...a) => void __logged.push('error: ' + a.map(String).join(' ')) };\n` +
    // use_figma's host doesn't support figma.loadAllPagesAsync (the plugin's runtime does). The
    // bundle gets a pass-through figma whose loadAllPagesAsync loads each page, as the real call does.
    `const __figma = {};\n` +
    `for (const k of new Set([...Object.getOwnPropertyNames(figma), ...Object.getOwnPropertyNames(Object.getPrototypeOf(figma) ?? {}), ...Object.keys(figma)])) if (!['loadAllPagesAsync', 'getLocalTextStylesAsync', 'getLocalPaintStylesAsync'].includes(k)) Object.defineProperty(__figma, k, { get: () => (typeof figma[k] === 'function' ? figma[k].bind(figma) : figma[k]), set: (v) => void (figma[k] = v) });\n` +
    `Object.defineProperty(__figma, 'loadAllPagesAsync', { value: async () => { for (const p of figma.root.children) await p.loadAsync(); } });\n` +
    // Styles in use_figma's host lack getPublishStatusAsync (plugin runtimes have it). Where it's
    // missing, the scenario must say how it knows (globalThis.__stylePublishStatus); never guessed.
    `const __styled = (s, f) => typeof s.getPublishStatusAsync === 'function' ? s : Object.assign(Object.fromEntries(f.map((k) => [k, s[k]])), { getPublishStatusAsync: async () => { if (!globalThis.__stylePublishStatus) throw new Error('style publish status unavailable in this host'); return globalThis.__stylePublishStatus(s); } });\n` +
    `Object.defineProperty(__figma, 'getLocalTextStylesAsync', { value: async () => (await figma.getLocalTextStylesAsync()).map((s) => __styled(s, ['id', 'key', 'name', 'remote', 'type', 'fontName', 'fontSize', 'lineHeight', 'letterSpacing'])) });\n` +
    `Object.defineProperty(__figma, 'getLocalPaintStylesAsync', { value: async () => (await figma.getLocalPaintStylesAsync()).map((s) => __styled(s, ['id', 'key', 'name', 'remote', 'type', 'paints'])) });\n` +
    `new Function('console', 'figma', SRC)(__console, __figma);\nconst DSD = globalThis.DSD;\n` + body;
  if (out.length > LIMIT) throw new Error(`${file}: ${out.length} chars exceeds use_figma's ${LIMIT}-char limit`);
  writeFileSync(`dev/e2e/${file.replace(/\.js$/, '')}.generated.js`, out);
}
const sizes = [];
for (const host of hosts) {
  parts.forEach((part, i) => {
    const out =
      `const PART = ${JSON.stringify(part)};\n` + checksumJs('PART') +
      `if (PART.length !== ${part.length} || sum !== ${checksum(part)}) throw new Error('part ${i + 1}/${n} mismatch ' + PART.length + ' ' + sum);\n` +
      `const host = await figma.getNodeByIdAsync('${host}');\nif (!host) throw new Error('host ${host} not found in this file');\n` +
      `host.setSharedPluginData('${NS}', 'bundle.${i}', PART);\n` +
      `return { installedOn: '${host}', part: '${i + 1}/${n}', chars: PART.length, bundleChecksum: ${sum} };\n`;
    if (out.length > LIMIT) throw new Error(`install part ${i + 1} for ${host}: ${out.length} chars exceeds ${LIMIT}`);
    sizes.push(out.length);
    writeFileSync(`dev/e2e/install-${hostFile(host)}-${i + 1}of${n}.generated.js`, out);
  });
}
console.log(`bundle ${src.length} chars, checksum ${sum}, ${n} parts (largest install ${Math.max(...sizes)} chars); ` +
  `${scenarios.length - skipped.length} scenarios; install hosts: ${[...hosts].join(', ')}`);
if (skipped.length) console.log(`not built yet: ${skipped.join('; ')}`);
