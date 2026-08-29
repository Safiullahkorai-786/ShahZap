# notify-push — Web Push delivery (Supabase Edge Function)

Delivers a browser/PWA push notification when a new row is inserted into the
`notifications` table. The DB trigger `push_on_notification_insert` fires an
async HTTP request via `pg_net` to this function, which uses the Web Push API
to send the notification to every saved subscription for the recipient —
even when ShahZap is closed (works while open, in the background, and on the
Android lock screen).

## Prerequisites (enable once, in the Supabase dashboard)

1. **Enable `pg_net`** so Postgres can call this function:
   - Dashboard → Database → Extensions → enable `pg_net` (or via SQL):
     ```sql
     create extension if not exists pg_net;
     ```
2. (Optional) Application-level functions (used by the trigger via
   `current_setting('app.settings.push_function_url', true)` and
   `current_setting('app.settings.push_hook_secret', true)`). If you leave
   these unset, edit the trigger's `v_url` / secret placeholders, or start
   the local supabase with:
   ```bash
   supabase start
   supabase db push
   ```
   The trigger default URL is `https://<YOUR-PROJECT-REF>.functions.supabase.co/notify-push`
   — replace `<YOUR-PROJECT-REF>` (or set `app.settings.push_function_url`).

## Build & deploy

```bash
# From the project root
supabase functions deploy notify-push --no-verify-jwt --project-ref <YOUR-PROJECT-REF>
```

Set the function secrets (Dashboard → Edge Functions → notify-push → Secrets,
or `supabase secrets set`):

| Secret | Description |
|---|---|
| `VAPID_PUBLIC_KEY` | Public VAPID key (shown to the app / service worker) |
| `VAPID_PRIVATE_KEY` | Private VAPID key (never expose to clients) |
| `VAPID_SUBJECT` | Contact e.g. `mailto:admin@example.com` |
| `PUSH_HOOK_SECRET` | Shared token used by the DB trigger (Bearer) |
| `SUPABASE_URL` | Your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for reading subscriptions |

The VAPID public key must also be hard-coded in `src/lib/push.ts` (client
side) so the browser can create a subscription authorized for this key.

> `web-push` and `@supabase/supabase-js` are imported via Deno `npm:` specifiers,
> so there is no `node_modules` — the function runs entirely in the edge runtime.
