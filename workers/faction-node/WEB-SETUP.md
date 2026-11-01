# Cloudflare website + GitHub setup

No local installation, terminal, launcher, file download, key copying or account access by the agent is required for this test workflow. Cloudflare's own build service runs the repository tools.

## Existing test Central

Rebuild the latest `feature/faction-node-v1` commit for `slink-chat-central-test`. Keep the already working database binding and runtime secrets. The previously used `wrangler.central-test.jsonc` filename is retained for compatibility; an existing working deployment command can keep using it.

For a new connection, use repository `Considious/SLINK-Cloudflare-Services`, branch `feature/faction-node-v1`, root `workers/faction-node/test-central`, build `npm ci`, deploy `npx wrangler deploy`. The folder now contains matching package/lock files, so no parent-directory command is needed. Do not rename the generic node configuration.

## Test faction node

In the existing `slink-faction-node-46978-test` Worker, connect the same repository/branch with:

| Setting | Value |
| --- | --- |
| Root directory | `workers/faction-node/test-node` |
| Build command | `npm ci` |
| Deploy command | `npx wrangler deploy` |

Deploy it. The committed configuration creates the Identity, Directory and Room SQLite Durable Object namespaces and binds them automatically. It does not connect to a production database or require a node private key secret.

When both builds succeed, open:

https://slink-faction-node-46978-test.richard-johnson554.workers.dev/setup

Click **Finish setup**. It generates/preserves the private identity inside Cloudflare, proves control of the exact approved node endpoint to test Central, registers faction 46978 with initial explicit Leader 3853023, verifies the signed certificate, and stores it in the node's private Durable Object. A successful response says `Backend setup complete`.

Rerunning setup renews the same identity; it does not replace an existing different registration. Do not delete identity storage or reset namespaces to troubleshoot. The older local identity/setup-token files are not used by this hosted workflow. No further setup SQL or node secret upload is needed, provided the earlier test database schema/license was applied.

## Boundaries

This is a narrowly preapproved **test** provisioning path, not a generic public commercial installer. The sole allowed endpoint, faction and initial Leader are fixed in repository code authorized by the owner. Public callers cannot choose their own key, endpoint, faction or Leader: Central obtains fresh signed proof directly from the fixed HTTPS node, does not follow redirects, checks the exact faction license and rejects another registered identity. Setup requests are rate limited. Certificate/public-key responses contain no private keys or ordinary member access token. Normal Chat authentication, room restrictions and explicit Leader rules remain unchanged; admin.* is not a shortcut.

Do not add this route to production. A general customer installer needs authenticated purchase/faction authorization and its own reviewed approval flow. Physical Torn/PDA acceptance, deployed retention/hibernation/billing and the clients' separate test-auth integration remain pending. A green build or backend setup response does not claim those are finished.

Local verification: 50 backend tests pass, including the real local Worker runtime completing this setup and sending/storing a message through its SQLite room. Both test configurations package successfully. The agent has not accessed or deployed through the owner's Cloudflare account.
