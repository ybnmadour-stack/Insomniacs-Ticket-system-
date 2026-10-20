# Free hosting: Cloudflare Workers + D1

The Halloween design, guest links, WhatsApp sharing and door scanner use the same screens. The cloud version uses Cloudflare D1 instead of the local SQLite file, so all door phones share durable ticket records. A conditional SQL update still admits each ticket once.

Use the Workers Free plan and D1 Free allowance. Do not select a paid plan. Free quotas apply; requests fail when daily quotas are exhausted. A custom domain is optional: the free HTTPS workers.dev address works on phones.

## Deployment

1. Sign in to Cloudflare. Under Workers & Pages, create a Worker connected to the GitHub repository `ybnmadour-stack/Insomniacs-Ticket-system-`.
2. Under Storage & databases → D1, create `insomniacs-tickets`. Copy the database UUID into `wrangler.jsonc` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID` and commit that change. The UUID is configuration, not a password.
3. In the D1 console run the SQL from `migrations/0001.sql` before opening the site. Alternatively run `npx wrangler d1 migrations apply insomniacs-tickets --remote` with an authenticated Cloudflare CLI.
4. In Worker settings, configure two **Secrets**, `ADMIN_PASSWORD` and `STAFF_PASSWORD`. Use different passwords of at least 12 characters. Never put their values in GitHub. These replace local account credentials for the cloud site.
5. Configure no build command and deploy command `npx wrangler deploy`. Wrangler reads the D1 binding and uploads the public assets. Redeploy after saving the secrets if the dashboard requires it.
6. Open the HTTPS workers.dev URL. Sign in as Organiser, fill party details and create a test ticket. On a phone sign in as Door team, scan it once (approved), then again (rejected). Confirm another staff phone also rejects it.

## Existing local guests

Local tickets are not automatically copied to D1. Keep the local database private. For an event already using local tickets, migrate config and ticket rows through a private, direct database import before switching; do not put an export in GitHub. Any localhost links already shared must be resent with the new public origin. The local server remains usable with `node server.mjs`.

## Security and operations

There is no public account-registration or setup endpoint in the cloud version. Passwords live in hosting Secrets. Login sessions and login rate limits are stored centrally in D1; sessions expire after 12 hours. When rotating passwords, revoke old sessions with `DELETE FROM sessions;` in the private D1 console. Guest ticket links contain unguessable tokens and disclose only that ticket's name and admission status. Keep them private.

Back up D1 through Cloudflare before the event. Door phones require internet; scanning never approves a ticket offline. Monitor the free quotas before opening the doors. Run a real multi-phone scan check after deployment; local tests do not verify your hosting configuration or camera hardware.
