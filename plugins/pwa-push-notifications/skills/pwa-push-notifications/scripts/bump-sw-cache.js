#!/usr/bin/env node
/**
 * bump-sw-cache.js — bump CACHE_VERSION in public/sw.js
 *
 * A PWA's service worker caches the app shell under a version-tagged cache
 * name. Installed PWAs keep serving the cached HTML (and therefore the OLD
 * chunk hashes) until the SW file itself changes and the `activate` handler
 * evicts the old caches. Changing `CACHE_VERSION` is what triggers that
 * eviction — so every release that touches app code must bump it.
 *
 * This script does the bump deterministically so it can be wired into the
 * build (`"build": "next build && node scripts/bump-sw-cache.js"`) or into
 * a git hook, instead of relying on the author to remember.
 *
 * Usage:
 *   node scripts/bump-sw-cache.js [--file public/sw.js] [--dry-run]
 *
 * Behaviour:
 *   - Finds `const CACHE_VERSION = '...'` (any quote style) in the SW file.
 *   - If the current value ends in digits, increments those digits.
 *   - Otherwise appends `-1` to the current value.
 *   - Leaves the file byte-identical apart from the version literal.
 *   - Exits 0 with a message when there is nothing to bump (no file, or
 *     no recognisable CACHE_VERSION line) so it is safe in a build chain.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function parseArgs(argv) {
    const args = { file: 'public/sw.js', dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--file' && argv[i + 1]) args.file = argv[++i];
        else if (a === '--dry-run') args.dryRun = true;
        else if (a.startsWith('--file=')) args.file = a.slice('--file='.length);
    }
    return args;
}

// const CACHE_VERSION = 'app-v12'   /   "app-v12"   /   `app-v12`
const VERSION_RE = /(\bCACHE_VERSION\s*=\s*)(['"`])([^'"`]*)\2/;

function bumpVersion(current) {
    const m = current.match(/^(.*?)(\d+)$/);
    if (m) return m[1] + (Number(m[2]) + 1);
    return `${current}-1`;
}

const args = parseArgs(process.argv.slice(2));
const path = resolve(process.cwd(), args.file);

if (!existsSync(path)) {
    console.log(`[bump-sw-cache] ${args.file} not found — nothing to bump.`);
    process.exit(0);
}

const src = readFileSync(path, 'utf8');
const match = src.match(VERSION_RE);

if (!match) {
    console.log(`[bump-sw-cache] no CACHE_VERSION assignment found in ${args.file} — nothing to bump.`);
    process.exit(0);
}

const [, prefix, quote, current] = match;
const next = bumpVersion(current);

if (current === next) {
    console.log(`[bump-sw-cache] CACHE_VERSION already at '${current}'.`);
    process.exit(0);
}

const updated = src.replace(VERSION_RE, `${prefix}${quote}${next}${quote}`);

if (args.dryRun) {
    console.log(`[bump-sw-cache] (dry run) CACHE_VERSION ${current} → ${next}`);
    process.exit(0);
}

writeFileSync(path, updated);
console.log(`[bump-sw-cache] CACHE_VERSION ${current} → ${next} (${args.file})`);
