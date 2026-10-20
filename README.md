# Bottles Up — Halloween Vol. 2

**Free cloud hosting is now supported:** see [FREE-HOSTING.md](FREE-HOSTING.md) for Cloudflare Workers + D1 setup. `worker.mjs` is the cloud entrypoint; `server.mjs` remains the local version. Run `node --test worker.test.mjs` to test the cloud API against a local SQL adapter. The instructions below describe the original local server.

Mobile ticketing with the supplied poster, WhatsApp sharing, QR tickets, staff camera scanning, organiser controls, and single-use admission. No online payments. Requires Node.js 24 or later. No package installation needed; QR libraries are included locally.

## Start

Run `node server.mjs` from this folder and open http://localhost:3000. Complete setup **on the host computer before exposing the server**. Choose two different passwords of at least 12 characters. Organiser access manages guests and party details; staff access only checks tickets in.

Set the date, venue, price, and capacity in Party details. Add each guest, confirm payment manually (or approve complimentary entry), then use WhatsApp to share their ticket. Guests do not sign in. The same ticket can only be redeemed once across all phones. Forwarded tickets can still be used by whoever arrives first; check guest names at the door if needed.

## Put it online

Deploy this Node server behind HTTPS on a host with a **persistent disk**. Use one server instance. Point `DATA_DIR` at that disk and set `PORT` if your host requires it. The reverse proxy must overwrite `X-Forwarded-Proto` with the actual public protocol. The host must support Node's built-in SQLite module. Use a stable public URL before sharing tickets. Opening local links on another phone will not work.

This copy is not publicly deployed. GitHub can hold the source, but GitHub Pages cannot run this shared ticket database. Phone cameras require HTTPS (localhost works for development). Every door phone needs internet. Do not run separate databases or replicas. Password setup only accepts loopback requests; complete it locally, or use an SSH port-forward when provisioning a remote host.

Database: `data/party.sqlite` by default. Back up the entire data directory while the server is stopped. Never commit it to GitHub; it contains guest details and password hashes. Restarting the server signs staff out but preserves tickets. Logins expire after 12 hours. Share the staff password only with the door team. The in-memory login attempt limit assumes one server process and is a baseline protection.

## Verify

Run `node --test test.mjs`. Checks cover atomic single-use admission, unpaid/cancelled/invalid tickets, role restrictions, and public guest access.

Included browser libraries: qrcode-generator 1.4.4 (MIT), jsQR 1.4.0 (Apache-2.0). Their source headers retain their licences. Poster supplied by the organiser. Google Fonts are optional; local fallback fonts work offline.
