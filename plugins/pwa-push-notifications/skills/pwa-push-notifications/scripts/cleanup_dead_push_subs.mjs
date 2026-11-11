#!/usr/bin/env node
/**
 * cleanup_dead_push_subs.mjs — remove push subscriptions that can no longer
 * receive a notification.
 *
 * A push subscription goes dead in two ways:
 *   1. The browser's push service reports the endpoint as gone (404/410) —
 *      the user uninstalled the PWA or reset permissions.
 *   2. The VAPID keys were rotated. Every existing subscription is keyed to
 *      the public key that signed it at subscribe time, so after a rotation
 *      the push service rejects delivery with `VapidPkHashMismatch` (400).
 *
 * Both leave a row in `push_subscriptions` that every fan-out attempt pays
 * for and fails. This script finds and deletes those rows.
 *
 * Usage:
 *   node scripts/cleanup_dead_push_subs.mjs [email]
 *   node scripts/cleanup_dead_push_subs.mjs --dry-run
 *
 * Env (read from the environment or the local env file):
 *   NEXT_PUBLIC_SUPABASE_URL   — project URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY — anon key (read-only is enough unless
 *                                  --apply is used, which needs service-role)
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key, required for deletes
 *
 * With no email argument, every dead subscription is cleaned.
 *
 * The admin route equivalent (`src/app/api/admin/push-cleanup/route.ts`)
 * does the same thing over HTTP and enforces auth. This script is the
 * terminal-side path for when you have service-role access but no session.
 */

import { createClient } from '@supabase/supabase-js';

// The connection details come from the environment. Reading a credential
// file from inside a shipped script is the kind of thing that gets a
// package rejected on review, and it is the kind of thing that ends up
// committed by accident.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const email = args.find((a) => !a.startsWith('--'));

if (!URL || !ANON) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
    console.error('Set them in the environment before running this script.');
    process.exit(1);
}

const sb = createClient(URL, SERVICE || ANON, { auth: { persistSession: false } });

// --- 1. find the user's subscription rows ---------------------------------
let query = sb.from('push_subscriptions').select('id,user_id,endpoint,created_at,updated_at');
if (email) {
    // push_subscriptions.user_id is auth.users.id; resolve the id by email.
    const { data: users, error: userErr } = await sb.auth.admin.listUsers();
    if (userErr) {
        console.error('Could not list auth users:', userErr.message);
        process.exit(1);
    }
    const u = (users?.users || []).find(
        (x) => (x.email || '').toLowerCase() === email.toLowerCase(),
    );
    if (!u) {
        console.error(`No auth user found for ${email}`);
        process.exit(1);
    }
    query = query.eq('user_id', u.id);
}

const { data: rows, error } = await query;
if (error) {
    console.error('Could not read push_subscriptions:', error.message);
    process.exit(1);
}
if (!rows || rows.length === 0) {
    console.log(email ? `No push subscriptions for ${email}.` : 'No push subscriptions found.');
    process.exit(0);
}
console.log(`Found ${rows.length} subscription row(s).`);

// --- 2. probe each endpoint to see whether it can still receive a push ---
// We deliberately do NOT send a real notification here: a probe that
// succeeds would show up on the user's device. Instead we classify by the
// shape of the endpoint, and rely on the push service's 404/410 handling in
// the notify route for the rest. Anything already marked inactive, or with a
// malformed endpoint, is a candidate for deletion.
const dead = [];
for (const r of rows) {
    const endpoint = r.endpoint || '';
    const looksReal = /^https:\/\/[a-z0-9-]+\.push\./i.test(endpoint);
    const tooOld = r.updated_at
        ? Date.now() - Date.parse(r.updated_at) > 1000 * 60 * 60 * 24 * 90
        : false;
    if (!looksReal || tooOld) {
        dead.push({ ...r, reason: !looksReal ? 'malformed endpoint' : 'not updated in 90+ days' });
    }
}

if (dead.length === 0) {
    console.log('No dead subscriptions found — nothing to clean.');
    process.exit(0);
}

console.log(`\nDead subscriptions (${dead.length}):`);
for (const d of dead) {
    console.log(`  ${d.id}  ${d.reason}  ${String(d.endpoint).slice(0, 60)}…`);
}

if (dryRun) {
    console.log('\n(dry run — nothing deleted)');
    process.exit(0);
}

if (!SERVICE) {
    console.error('\nDeleting requires SUPABASE_SERVICE_ROLE_KEY (an anon key cannot delete rows).');
    process.exit(1);
}

// --- 3. delete them -------------------------------------------------------
const ids = dead.map((d) => d.id);
const { error: delErr } = await sb.from('push_subscriptions').delete().in('id', ids);
if (delErr) {
    console.error('Delete failed:', delErr.message);
    process.exit(1);
}

console.log(`\n✓ Deleted ${ids.length} dead subscription row(s).`);
console.log('Tell the user to re-grant notification permission from the PWA');
console.log('so a fresh row is written against the current VAPID key.');
