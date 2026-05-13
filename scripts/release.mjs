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

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

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

function captureFile(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// --- pre-flight checks ------------------------------------------------------

// Untracked files are ignored on purpose: this script only stages the files
// it writes (workspace package.json files + pnpm-lock.yaml). Modifications
// to tracked files DO block, since `git add` of the release files could miss
// related staged work.
const dirty = capture('git status --porcelain')
  .split('\n')
  .filter((line) => line && !line.startsWith('??'));
if (dirty.length) {
  console.error('✗ Tracked files have uncommitted changes:');
  console.error(dirty.join('\n'));
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

const workspaceFiles = JSON.parse(
  captureFile('pnpm', ['-r', 'list', '--depth', '-1', '--json']),
)
  .map(({ path }) => relative(ROOT, realpathSync(join(path, 'package.json'))) || 'package.json')
  .sort();

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
const filesToStage = [...workspaceFiles, 'pnpm-lock.yaml'];
run(`git add -- ${filesToStage.join(' ')}`);
// --no-verify: release commit is mechanical (version bumps + lockfile). Quality
// gates run on the tag in CI, not on this local commit.
run(`git commit --no-verify -m "Release ${tag}"`);
run(`git tag -a ${tag} -m "Release ${tag}"`);
run(`git push --atomic origin main refs/tags/${tag}`);

console.log(`\n✓ Released ${tag}`);
console.log(`  Watch CI: https://github.com/chuibot/chuiwallet/actions`);
