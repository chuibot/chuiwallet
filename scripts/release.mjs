#!/usr/bin/env node
/**
 * pnpm release:{patch|minor|major}
 *
 * Bumps every workspace package.json to the next semver, refreshes
 * pnpm-lock.yaml, commits, tags vX.Y.Z, and pushes the branch + tag.
 *
 * Release pipeline:
 *   1. local: pnpm release:<bump>
 *   2. tag push triggers .github/workflows/release.yaml
 *   3. workflow builds, zips, and attaches the zip to a GitHub Release
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BUMP = process.argv[2];
const ALLOWED = ['patch', 'minor', 'major'];
if (!ALLOWED.includes(BUMP)) {
  console.error(`Usage: pnpm release:${ALLOWED.join('|')}`);
  console.error(`Got: ${BUMP ?? '(nothing)'}`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}

function capture(cmd) {
  return execSync(cmd, { cwd: ROOT }).toString().trim();
}

// --- pre-flight checks ------------------------------------------------------

if (capture('git status --porcelain')) {
  console.error('✗ Working tree is dirty. Commit or stash before releasing.');
  process.exit(1);
}

const branch = capture('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') {
  console.error(`✗ Releases must be cut from main, currently on "${branch}".`);
  process.exit(1);
}

run('git fetch origin main --quiet');
const local = capture('git rev-parse HEAD');
const remote = capture('git rev-parse origin/main');
if (local !== remote) {
  console.error('✗ Local main is not in sync with origin/main. Pull first.');
  process.exit(1);
}

// --- compute the next version ----------------------------------------------

const extPath = join(ROOT, 'chrome-extension/package.json');
const current = JSON.parse(readFileSync(extPath, 'utf8')).version;
const [maj, min, pat] = current.split('.').map(Number);
const next =
  BUMP === 'major' ? `${maj + 1}.0.0` :
  BUMP === 'minor' ? `${maj}.${min + 1}.0` :
  `${maj}.${min}.${pat + 1}`;

console.log(`Releasing ${current} → ${next}`);

// --- collect every workspace package.json ----------------------------------

const workspaceFiles = [
  'package.json',
  'chrome-extension/package.json',
  'pages/popup/package.json',
  ...readdirSync(join(ROOT, 'packages'))
    .map((d) => `packages/${d}/package.json`)
    .filter((rel) => existsSync(join(ROOT, rel))),
];

// --- bump every package.json -----------------------------------------------

for (const rel of workspaceFiles) {
  const abs = join(ROOT, rel);
  const src = readFileSync(abs, 'utf8');
  // Anchored regex on the top-level "version" so we never touch
  // "manifest_version" or peer/devDep version strings.
  const versionLine = /^(\s*"version":\s*")([^"]+)(",?)/m;
  if (!versionLine.test(src)) {
    console.error(`✗ No top-level "version" in ${rel}`);
    process.exit(1);
  }
  const updated = src.replace(versionLine, `$1${next}$3`);
  writeFileSync(abs, updated);
  console.log(`  ${rel}: ${next}`);
}

// --- refresh lockfile ------------------------------------------------------

run('pnpm install --lockfile-only');

// --- commit, tag, push -----------------------------------------------------

const tag = `v${next}`;
run('git add -A');
run(`git commit -m "Release ${tag}"`);
run(`git tag ${tag}`);
run('git push origin main --follow-tags');

console.log(`\n✓ Released ${tag}`);
console.log(`  Watch CI: https://github.com/chuibot/chuiwallet/actions`);
