# Cloudflare website + GitHub setup

## Main branch going forward

The faction room implementation is now published on main. For both existing chat Workers, change Settings → Builds → Production branch to **main** once, then keep the working root directories, commands, bindings, secrets and node identity unchanged. Future main commits can then deploy normally. The repository cannot change that dashboard branch selection itself. No new SQL or registration is required for the working faction 46978 installation.

## Room layout and verified-name update

An already working faction 46978 setup does not need new SQL, secrets, bindings, registration or another Finish setup run. The client UI changes arrive in the feature extension/PDA downloads. The name fix also requires the existing **slink-chat-central-test** Worker to deploy the latest `main` commit. An enabled GitHub build connection should do this automatically; if it does not, retry its latest build in Cloudflare's website. Do not change the already working build paths or Worker names.

The Central health endpoint reports `version: "0.1.1-room-names"` once this source is deployed. Reconnect a room afterward to refresh the short-lived signed identity. Existing messages may retain names recorded at send time; clients resolve generic historical labels using verified identities/presence/roster names already available, without making a Torn request for every message.

No local installation, terminal, launcher, file download, key copying or account access by the agent is required for this test workflow. Cloudflare's own build service runs the repository tools.

## Existing test Central

Rebuild the latest `main` commit for `slink-chat-central-test`. Keep the already working database binding and runtime secrets. The previously used `wrangler.central-test.jsonc` filename is retained for compatibility; an existing working deployment command can keep using it.

For a new connection, use repository `Considious/SLINK-Cloudflare-Services`, branch `main`, root `workers/faction-node/test-central`, build `npm ci`, deploy `npx wrangler deploy`. The folder now contains matching package/lock files, so no parent-directory command is needed. Do not rename the generic node configuration.

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

Do not add this route to production. A general customer installer needs authenticated purchase/faction authorization and its own reviewed approval flow. Physical Torn/PDA acceptance and deployed retention/hibernation/billing remain pending. The separate test-auth client integration is described below; a green build or backend setup response does not claim physical-device acceptance is finished.

## Test clients

The hosted registration handshake has now succeeded for faction 46978 / Leader 3853023. Feature-branch extension/PDA clients now authenticate separately against test Central. Install/reload the feature extension, or install the separate `SLINK_PDA_Faction_Node_Test.user.js` in PDA with the normal SLINK script disabled. Do not run two PDA copies together.

Use your already saved Torn key and accepted current terms in Access; do not clear settings or replace production endpoints. Enable **Quality of Life → Faction Rooms → Show faction rooms in Torn chat**, then open **Rooms** in Torn's chat row. Test sign-in keeps its short-lived permission session in memory and leaves your normal SLINK login/permissions intact. Your key is sent only to SLINK test Central, never to the faction-owned node. No production Chat grant or admin wildcard is needed to see this settings panel; the test service checks actual faction membership/license, and the node checks its explicit Leader list.

The test Central wrapper accepts valid `chrome-extension://` origins for unpacked test builds, with exact-origin responses and normal token verification. Unknown HTTPS origins stay forbidden. The shared member picker uses the test database's last verified roster; IDs remain usable if that test roster is empty. Physical Torn/PDA and a second-member test are not yet verified.

Both test Worker configurations enable `global_fetch_strictly_public`, required for their public Worker-to-Worker requests on the shared workers.dev zone. It is also set in the legacy Central configuration alias. Setup reports the actual service, HTTP status, content type and Cloudflare 1042 code instead of calling an HTML/plaintext/empty upstream response invalid user JSON. Both Workers must deploy the updated configuration; changing only client code does not set a compatibility flag.

Local verification: 53 backend tests pass, including an injected edge 1042 failure and the real local Worker runtime completing setup and sending/storing a message through its SQLite room. The agent has not accessed or deployed through the owner's Cloudflare account. Public health routes can succeed even when the Worker-to-Worker request fails; they are not proof of the handshake.
