# SLINK Faction Node

Faction-owned chat for SLINK. Your faction runs a small service in **its own Cloudflare account**, where its rooms, messages and settings are stored. SLINK Central verifies users and supplies the address of your faction's service; Central does not store the conversations.

**Development build — not ready for general installation.** The backend and setup wizard are implemented and tested locally. The Torn chat-bar interface, Leader controls, extension/PDA integration and customer deployment acceptance tests are still being built. No existing SLINK installation is changed by downloading this package.

## What you need

- A Cloudflare account you control.
- Node.js 22.13 or newer on a computer.
- An active faction license for `slink.chat`, separate from SLINK's existing chat customization.
- Your Torn faction ID and the Torn user ID of the first Chat Leader.
- A new, unused Worker name, your Cloudflare account ID, and its exact public HTTPS address.
- A short-lived setup token from SLINK Central, approved for that faction, address and initial Leader.

Never send anyone your Cloudflare password. The wizard opens Cloudflare's normal sign-in flow through Wrangler. It does not ask for or send Cloudflare credentials to SLINK.

## Install — once testing is enabled

1. Download this package into a private folder on your computer. Keep it out of publicly shared or automatically published folders.
2. Open a terminal in that folder and run `npm ci`.
3. Run `npm run setup`.
4. Enter the requested faction, initial Leader, Worker name, account ID and HTTPS address. Confirm deployment only if the Worker name belongs to this new node.
5. Complete Cloudflare sign-in. The wizard deploys the Worker and both SQLite-backed Durable Object bindings.
6. Obtain a setup token from SLINK Central for the exact information shown. Paste it when prompted; it is hidden and is not saved.
7. The wizard registers the node, uploads its secrets privately, and checks its public certificate before reporting success.

For an automatically assigned `workers.dev` address, use the chosen Worker name and your Cloudflare account's workers.dev subdomain. A custom domain must already be routed to the correct Worker. The wizard stops if the supplied address serves a different node.

If a step fails, **keep `node-config.json`** and run setup again. It preserves the same identity rather than silently creating a replacement. A lost successful registration response can be retried with the same setup token and private identity before the token expires. If that token has expired before any certificate was saved locally, SLINK Central must help recover the registration; do not register a competing node.

## Private configuration

`node-config.json` contains the node's private signing key. Store a private backup. Anyone with that file can impersonate this node to its approved links. Do not post it in chat, attach it to bug reports or commit it to GitHub. `wrangler.local.json` stores deployment settings, not signing secrets. Both files are ignored by Git.

The installer requests owner-only file permissions where supported. On Windows, folder access permissions still matter; keep the folder private to your account. Cloudflare OAuth credentials remain under Wrangler's control, not SLINK's configuration. Sign out with Wrangler when finished if you do not want that computer to retain deployment access.

## Updating

Keep your private configuration files, replace the package source with the approved update, run `npm ci`, then `npm run upgrade`. Upgrades preserve the node ID, key, faction, target, custom routes, retention settings and Durable Object migration history. They renew the Central-signed node certificate, which lasts one year. Renew before it expires.

Do not deploy the unconfigured example `wrangler.jsonc` over your actual node. Setup uses your generated `wrangler.local.json` instead. Do not rename the Worker or its Durable Object classes as an update shortcut: that can create a different data namespace.

## Rooms and moderation

- **Entire faction:** current authenticated faction members can read and speak by default.
- **Selected members:** only assigned members and explicit Chat Leaders can enter. This supports officers-only and team rooms without making everyone an administrator.
- **Leaders only:** assigned Chat Leaders only.

Leaders can assign room moderators and independently manage read access, speaking permission, temporary access grants, temporary access blocks and timed/permanent mutes. Expiry restores the underlying permission; it never overrides another restriction. A mute prevents new messages, edits and typing indicators, but the user can still read and delete their own messages. Removing an override restores the room's normal defaults. The last Leader cannot remove themselves until another is assigned.

Archived rooms stop accepting connections and sever their links; archival is not a promise that historical data has been erased. Message retention defaults to 30 days and at most the latest 10,000 sequence positions per room. Cleanup runs during activity and through an alarm scheduled for the oldest message's expiry, rounded up to the next hour. Inactive rooms therefore do not need to be opened for retention cleanup, but deletion is not promised at the exact expiry second. Physical deletion behavior still needs a deployed acceptance check.

## Linking factions

Both factions need registered nodes and explicit Leaders. One Leader creates a signed invitation for a specific other faction; the other Leader chooses a local room and approves it. Invitations expire after 30 minutes. Each approved link has its own secret. Either side can revoke a link without the other's approval.

Only future messages and their updates cross a link; creating a link does not backfill old conversations. A locally moderated deletion of a remote message hides it locally, not in every independent customer's archive. Linked recipients can retain messages they already received, even after unlinking. Local delivery continues if the other node is offline; remote attempts are limited to three within a three-minute queue lifetime. A failed remote delivery is not silently retried forever.

## Uninstalling

First unlink remote factions and ask SLINK Central to revoke discovery/access for this node. Removing only a domain route does not erase chat history. Deleting the Worker, Durable Object storage/namespaces or associated resources can **permanently destroy conversations**. Export or otherwise preserve anything you need before doing that through your Cloudflare account. This package does not run an automatic destructive uninstaller.

## Troubleshooting

- **License required:** your faction needs its separate Chat license; existing QOL chat access does not replace it.
- **Setup token expired/used:** use the same saved node identity for a retry, or request help from Central. Never clear private configuration as a fix.
- **Node identity mismatch:** the configured address, faction or deployment does not match registration. Check Cloudflare routing and use the matching private configuration.
- **Access expired:** the SLINK client must refresh its verified faction identity. The backend never accepts an expired token as a fallback.
- **Directory save not confirmed:** reopen room management to view the saved state before retrying. Saved room changes awaiting propagation are retried by the next request.
- **Linked delivery pending/failed:** local chat still works. Leaders should check the remote node and link; do not resend repeatedly assuming the original never saved.

Safe diagnostics do not include API keys, private keys, access tokens, link secrets or message contents. Do not paste those into support messages.

See [Security](SECURITY.md), [Architecture](ARCHITECTURE.md), [Costs](COSTS.md), and [Testing](TESTING.md).
