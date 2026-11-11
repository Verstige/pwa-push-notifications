#!/usr/bin/env node
/**
 * test_push_to_user.mjs
 *
 * Aug 17 2026 — Direct end-to-end web-push smoke test for a single user.
 *
 * WHAT THIS DOES (and what it doesn't):
 *   Bypasses the admin-token `/api/push/send` surface. Reads the
 *   exact VAPID keys Railway has configured, fetches the target
 *   user's push_subscriptions rows (with their real p256dh +
 *   auth), and calls `webpush.sendNotification()` directly. The
 *   push broker's HTTP status is the source of truth.
 *
 * WHY IT EXISTS:
 *   When a user reports "push isn't working" and the standard
 *   admin path returns nothing useful, going direct surfaces
 *   errors the admin path hides (VapidPkHashMismatch specifically).
 *   See pwa-web-push skill § 22a for the full diagnostic recipe.
 *
 * TROUBLE CODES THE BROKER RETURNS:
 *   201                       = accepted; should land on device
 *   400 VapidPkHashMismatch   = subscription was created with a
 *                              different VAPID key → re-subscribe
 *                              required (skill § 22)
 *   404 / 410                 = subscription endpoint expired;
 *                              route auto-deactivates on next
 *                              fan-out; user re-subscribes
 *   401 / 403                 = JWT/private key mismatch; verify
 *                              VAPID_PUBLIC_KEY and the matching
 *                              private half in Railway
 *
 * USAGE:
 *   1. Edit TARGET_USER_UUID below to the target user (or wire to an
 *      --email arg via the script args).
 *   2. Run `node scripts/test_push_to_user.mjs`. Must run from a
 *      directory where `railway variable list` works (i.e. a
 *      Railway-linked project checkout).
 *
 * REQUIREMENTS:
 *   - Authenticated `railway` CLI (`railway login`)
 *   - VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in Railway
 *   - `web-push` npm package installed
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
 */

import webpush from 'web-push'
import { spawn } from 'node:child_process'

// The service role key comes from the environment. Digging it out of a
// migration file is the kind of shortcut that ends up committed.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in the environment')
}
const SUPABASE_URL = process.env.SUPABASE_URL
if (!SUPABASE_URL) {
    throw new Error('SUPABASE_URL is not set in the environment')
}
const BASE = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`

const TARGET_USER_UUID = '00000000-0000-0000-0000-000000000000'

function getVapidFromRailway() {
    return new Promise((resolve, reject) => {
        const child = spawn('railway', ['variable', 'list', '--kv'], {
            cwd: process.cwd(),
        })
        let stdout = ''
        child.stdout.on('data', (c) => stdout += c.toString())
        child.on('close', () => {
            const vars = {}
            for (const line of stdout.split('\n')) {
                const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
                if (m) vars[m[1]] = m[2]
            }
            resolve({
                pub: vars.VAPID_PUBLIC_KEY,
                priv: vars.VAPID_PRIVATE_KEY,
                subj: vars.VAPID_SUBJECT || 'mailto:<admin-email>',
            })
        })
        child.on('error', reject)
    })
}

async function main() {
    console.log('=== Direct Web-Push Smoke Test ===\n')

    const vapid = await getVapidFromRailway()
    if (!vapid.pub || !vapid.priv) {
        console.log('VAPID keys missing. Refusing to test without them.')
        process.exit(1)
    }
    console.log(`VAPID keys loaded from Railway  (subject: ${vapid.subj})`)
    console.log(`  pub prefix: ${vapid.pub.slice(0, 20)}...`)
    console.log(`  priv prefix: ${vapid.priv.slice(0, 20)}...`)

    webpush.setVapidDetails(vapid.subj, vapid.pub, vapid.priv)

    const subsRes = await fetch(
        `${BASE}/push_subscriptions?user_id=eq.${TARGET_USER_UUID}&select=id,endpoint,p256dh,auth,created_at`,
        {
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
            },
        },
    )
    const subs = await subsRes.json()
    console.log(`\nSubscriptions (${subs.length}):`)
    for (const s of subs) {
        const keyLenOk = s.p256dh?.length === 87 && s.auth?.length === 24
        console.log(`  #${s.id}  ${s.endpoint.slice(0, 65)}...`)
        console.log(`    created: ${s.created_at}  key_shape_ok=${keyLenOk}`)
        if (!keyLenOk) {
            console.log(`    ⚠️  Unexpected p256dh/auth shape — p256dh should be 87 chars (base64 of 65 bytes), auth 24 chars (base64 of 16 bytes).`)
            console.log(`    ⚠️  p256dh length: ${s.p256dh?.length}, auth length: ${s.auth?.length}. Bail out and inspect upstream.`)
            return
        }
    }
    if (subs.length === 0) {
        console.log('\nNo subscriptions. User needs to re-grant push permission in the PWA.')
        return
    }

    const payload = JSON.stringify({
        title: '🧪 Push Test',
        body: `the target platform push test fired at ${new Date().toISOString().slice(0, 19)}Z. If you see this on your phone, notifications are working.`,
        icon: '/icons/icon-192.png',
        tag: 'test-push',
        url: '/dashboard',
    })

    console.log('\nSending...\n')
    let ok = 0, fail = 0
    for (const s of subs) {
        try {
            const result = await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                payload,
                { TTL: 60 },
            )
            ok++
            console.log(`  [${result.statusCode}]  ${s.endpoint.slice(0, 50)}...`)
        } catch (err) {
            fail++
            console.log(`  [FAIL ${err.statusCode ?? '?'}]  ${s.endpoint.slice(0, 50)}...`)
            const body = err.body?.slice(0, 200) || err.message?.slice(0, 200) || 'unknown'
            console.log(`    body: ${body}`)
        }
    }
    console.log(`\nSummary: ${ok} OK, ${fail} failed`)
    if (fail > 0) {
        console.log('\nDiagnosis cheat sheet:')
        console.log('  400 + VapidPkHashMismatch  → re-subscribe required (skill § 22)')
        console.log('  404 / 410                  → endpoint expired, auto-deactivated, user must re-subscribe')
        console.log('  401 / 403                  → VAPID private key mismatch in Railway')
    }
}

main().catch((e) => {
    console.error('failed:', e)
    process.exit(1)
})
