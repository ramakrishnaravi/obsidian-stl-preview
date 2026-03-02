#!/usr/bin/env node
/**
 * Usage: node scripts/version.mjs <X.Y.Z>
 *
 * Updates version in:
 *   - manifest.json
 *   - package.json
 *   - versions.json  (adds entry: "X.Y.Z": <minAppVersion from manifest>)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const root   = resolve(__dir, '..');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/version.mjs <X.Y.Z>');
  process.exit(1);
}

function readJson(rel) {
  return JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
}

function writeJson(rel, obj) {
  writeFileSync(resolve(root, rel), JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log(`Updated ${rel}`);
}

// manifest.json
const manifest = readJson('manifest.json');
manifest.version = version;
writeJson('manifest.json', manifest);

// package.json
const pkg = readJson('package.json');
pkg.version = version;
writeJson('package.json', pkg);

// versions.json  — map plugin version → minimum Obsidian version
if (!manifest.minAppVersion) {
  console.error('manifest.json is missing minAppVersion');
  process.exit(1);
}

const versions = readJson('versions.json');
versions[version] = manifest.minAppVersion;
writeJson('versions.json', versions);

console.log(`\nVersion bumped to ${version}`);
