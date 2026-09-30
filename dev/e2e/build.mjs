// Builds use_figma-ready scripts that run the plugin's production code (controller, audit,
// navigation) inside a real Figma file.
//
// use_figma accepts at most 50,000 characters per call, and the bundle alone is ~47,000. So the
// bundle is installed once per test host (a page node on a test page) as shared plugin data:
//   install-<host>.generated.js   stores the checksum-verified bundle on that node
//   <scenario>.generated.js       loads it, re-verifies the checksum, then runs the scenario
// Scenarios declare their host on their first line: `// @host 45:2`.
//   node dev/e2e/build.mjs
import * as esbuild from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

await esbuild.build({
  entryPoints: ['dev/figma-e2e.ts'], bundle: true, minify: true, target: 'es2017', format: 'iife',
  outfile: 'dev/figma-e2e.js', logLevel: 'warning', charset: 'utf8',
});
const src = readFileSync('dev/figma-e2e.js', 'utf8');
let sum = 0;
for (let i = 0; i < src.length; i++) sum = (sum * 31 + src.charCodeAt(i)) >>> 0;
const LIMIT = 50000;
const NS = 'dsd_e2e';
const checksumJs = (v) => `let sum = 0; for (let i = 0; i < ${v}.length; i++) sum = (sum * 31 + ${v}.charCodeAt(i)) >>> 0;\n`;

const scenarios = readdirSync('dev/e2e').filter((f) => f.endsWith('.js') && !f.endsWith('.generated.js'));
const hosts = new Set();
for (const file of scenarios) {
  const body = readFileSync(`dev/e2e/${file}`, 'utf8');
  const host = body.match(/^\/\/ @host (\S+)/)?.[1];
  if (!host) throw new Error(`${file}: first line must be "// @host <nodeId>"`);
  hosts.add(host);
  const out =
    `const __host = await figma.getNodeByIdAsync('${host}');\n` +
    `const SRC = __host ? __host.getSharedPluginData('${NS}', 'bundle') : '';\n` +
    checksumJs('SRC') +
    `if (SRC.length !== ${src.length} || sum !== ${sum}) throw new Error('Bundle ${sum} is not installed on ${host}: run install-${host.replace(':', '-')}.generated.js first');\n` +
    `new Function(SRC)();\nconst DSD = globalThis.DSD;\n` + body;
  if (out.length > LIMIT) throw new Error(`${file}: ${out.length} chars exceeds use_figma's ${LIMIT}-char limit`);
  writeFileSync(`dev/e2e/${file.replace(/\.js$/, '')}.generated.js`, out);
}
for (const host of hosts) {
  const out =
    `const SRC = ${JSON.stringify(src)};\n` + checksumJs('SRC') +
    `if (SRC.length !== ${src.length} || sum !== ${sum}) throw new Error('bundle mismatch ' + SRC.length + ' ' + sum);\n` +
    `const host = await figma.getNodeByIdAsync('${host}');\nif (!host) throw new Error('host ${host} not found in this file');\n` +
    `host.setSharedPluginData('${NS}', 'bundle', SRC);\n` +
    `return { installedOn: '${host}', hostName: host.name, chars: SRC.length, checksum: sum, readBack: host.getSharedPluginData('${NS}', 'bundle').length };\n`;
  if (out.length > LIMIT) throw new Error(`install for ${host}: ${out.length} chars exceeds ${LIMIT}`);
  writeFileSync(`dev/e2e/install-${host.replace(':', '-')}.generated.js`, out);
}
console.log(`bundle ${src.length} chars, checksum ${sum}; ${scenarios.length} scenarios; install hosts: ${[...hosts].join(', ')}`);
