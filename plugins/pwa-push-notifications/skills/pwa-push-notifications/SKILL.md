---
name: pwa-push-notifications
description: "Build a Progressive Web App (PWA) on Next.js with Web Push (VAPID) notifications so users can install the app to their home screen and receive native push notifications when events fire \u2014 messages and alerts. Covers manifest.json authoring, service worker (app-shell caching, push handler, notificationclick), VAPID key generation and storage, push_subscriptions table schema, server-side fan-out via the web-push npm package, and the iOS Safari quirks that bite every PWA (no beforeinstallprompt event, push only works from home-screen-launched standalone, Safari-only install path). Use when the user says \"make this a PWA\", \"let users install the app\", \"add push notifications to the phone\", \"send native browser push\", \"Web Push VAPID\", or wants mobile-app-like behavior without going through the App Store."
version: 1.0.0
license: MIT
author: "the maintainers"
---
# PWA and Web Push

## Purpose

Make a web application installable and deliver user-authorized notifications. Examples must use synthetic users, endpoints and application names.

## Implementation

1. Serve over HTTPS, with localhost as a development exception. Add a web app manifest with a name, start URL, display mode and suitable icons.
2. Register a service worker at the intended scope. Version caches and remove obsolete cache versions on activation. Never cache authenticated API responses or private account pages by default.
3. Show an explicit Enable notifications control. Request permission only after the user activates it; explain what notifications they will receive.
4. Generate VAPID keys for each environment. Publish the public key only. Store the private key and provider credentials on the server.
5. Subscribe using PushManager and the public key. Send the subscription to an authenticated server route. Associate it with the current user on the server, not a client-supplied user ID.
6. Authorize every send. Evaluate the recipient's current permissions and preferences from a shared server-side policy. Do not copy business access thresholds into notification routes.
7. Queue sends with bounded retries. Treat expired subscriptions as inactive; distinguish provider acceptance from actual device display.
8. Handle push events with event.waitUntil and showNotification. Use notificationclick to focus an existing allowed application URL or open one. Reject arbitrary external navigation targets from payloads.
9. Provide unsubscribe and account-deletion cleanup. Avoid sensitive message content on lock screens; prefer a generic alert and an authenticated deep link.

## Platform checks

Verify installation, permission and delivery on each supported browser and device. On iOS, test the installed home-screen application and provide platform-appropriate installation guidance. Feature-detect browser APIs rather than assuming support.

## Verification

- Fresh install, denied permission and revoked permission have clear UI states.
- One user cannot register a subscription for another user.
- One user cannot trigger unauthorized sends.
- Logged-out clients cannot read private cached content.
- Click targets stay within the application allowlist.
- Expired subscriptions are cleaned up without disabling healthy subscriptions.
- Logs and fixtures contain no real endpoints, users, credentials or business rules.
