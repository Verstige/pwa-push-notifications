#!/usr/bin/env node
import { randomBytes as privacyRandomBytes } from 'node:crypto';
/**
 * seed-and-send-test-push.mjs — Seed a subscription and fire a test push
 *
 * Use when:
 *   - You want to test the server-side fan-out pipeline without going
 *     through a real browser (no real notification lands; the fake endpoint
 *     will 404 and get deactivated, but the API path is exercised).
 *   - You have a real subscription row in `push_subscriptions` and want
 *     to fire a specific payload to it.
 *
 * Auth:
 *   - Requires PUSH_API_TOKEN or ADMIN_BOOTSTRAP_TOKEN env var (NOT in
 *     local the local env file — pull from Railway: `railway variables --kv`).
 *
 * Usage:
 *   PUSH_API_TOKEN=*** node scripts/seed-and-send-test-push.mjs
 *   APP_URL=https://www.yourdomain.com PUSH_API_TOKEN=*** node scripts/seed-and-send-test-push.mjs
 *
 * What it does:
 *   1. Resolves the target user_id from auth.users (via Supabase admin API)
 *   2. Upserts a test subscription row (fake FCM endpoint)
 *   3. POSTs to /api/push/send with a ENGINE_A NAS100 SELL payload
 *   4. Logs the response
 *   5. Cleans up the test row
 *
 * Caveats:
 *   - The fake endpoint will fail at the web-push layer (404/410), so
 *     `last_sent_at` won't update and the row will be deactivated.
 *     This is expected for a server-side test of the pipeline.
 *   - For a real notification on a real device, the user must complete
 *     the browser-side subscribe flow (see SKILL.md pitfall #10).
 */

import { createClient } from '@supabase/supabase-js';

// The connection values come from the environment the caller supplies.
// Export them before running this script, or let the shell read them from
// wherever the project keeps its local settings:
//   export NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=...
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TOKEN = process.env.PUSH_API_TOKEN || process.env.ADMIN_BOOTSTRAP_TOKEN;
const APP_URL = process.env.APP_URL || 'https://www.yourdomain.com';
const TARGET_EMAIL = process.env.TARGET_EMAIL || 'user@example.com';

if (!TOKEN) {
    console.error('Missing PUSH_API_TOKEN or ADMIN_BOOTSTRAP_TOKEN env var');
    console.error('Pull from Railway: railway variables --kv | grep PUSH_API_TOKEN');
    console.error('Then run: PUSH_API_TOKEN=*** node scripts/seed-and-send-test-push.mjs');
    process.exit(1);
}
if (!URL || !ANON) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment');
    process.exit(1);
}

const sb = createClient(URL, ANON, { auth: { persistSession: false } });

// Resolve target user_id from auth.users via admin API
console.log(`Resolving user_id for ${TARGET_EMAIL}…`);
const { data: usersData, error: usersErr } = await sb.auth.admin.listUsers();
let targetId = null;
if (!usersErr && usersData?.users) {
    const u = usersData.users.find(u => (u.email || '').toLowerCase() === TARGET_EMAIL.toLowerCase());
    if (u) targetId = u.id;
}
if (!targetId) {
    console.error(`Could not resolve user_id for ${TARGET_EMAIL}`);
    console.error('Admin endpoint error:', usersErr?.message || 'user not found');
    process.exit(1);
}
console.log(`  user_id = ${targetId}`);

// Seed (or update) a fake push subscription
const fakeEndpoint = `https://fcm.googleapis.com/fcm/send/test-${Date.now()}`;
const fakeKeys = {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I2e0MYa0B8V_c',
    auth: privacyRandomBytes(16).toString('base64url'),
};

console.log(`Seeding test subscription at ${fakeEndpoint.slice(0, 60)}…`);
const { error: subErr } = await sb.from('push_subscriptions').upsert({
    user_id: targetId,
    endpoint: fakeEndpoint,
    p256dh: fakeKeys.p256dh,
    auth: fakeKeys.auth,
    user_agent: 'node-test-script/pwa-web-push-skill',
    is_active: true,
    updated_at: new Date().toISOString(),
}, { onConflict: 'endpoint' });

if (subErr) {
    console.error('Subscription insert failed:', subErr.message);
    process.exit(1);
}
console.log(`  ✓ seeded`);

// Fire the test push
const sendPayload = {
    user_id: targetId,
    payload: {
        title: '🔵 ENGINE_A — NAS100 SELL',
        body:  'ENTRY @ 27850.0  SL 27920  TP1 27780  Score 87/100',
        url:   '/dashboard/trading?tab=SIGNALS',
        tag:   'engine-engine-a-nas100',
        icon:  '/icons/icon-192.png',
    },
};

console.log(`\n→ POST ${APP_URL}/api/push/send`);
const res = await fetch(`${APP_URL}/api/push/send`, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type':  'application/json',
    },
    body: JSON.stringify(sendPayload),
});

const status = res.status;
const body = await res.json().catch(() => ({}));
console.log(`← HTTP ${status}`);
console.log(JSON.stringify(body, null, 2));

// Clean up the test row regardless of outcome
const { error: delErr } = await sb.from('push_subscriptions')
    .delete().eq('endpoint', fakeEndpoint);
if (delErr) {
    console.error(`Warning: cleanup failed: ${delErr.message}`);
} else {
    console.log('\n✓ Test row cleaned up');
}

// Exit non-zero on non-2xx so CI/cron callers can detect failure
process.exit(status >= 200 && status < 300 ? 0 : 1);
