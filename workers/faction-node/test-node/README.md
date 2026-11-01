# Test faction node deployment

Cloudflare build root: `workers/faction-node/test-node`.

- Branch: `feature/faction-node-v1`
- Build: `npm ci`
- Deploy: `npx wrangler deploy`

After Central and this node deploy successfully, open https://slink-faction-node-46978-test.richard-johnson554.workers.dev/setup and click **Finish setup**. No local tools or private-key copying are required. See [the complete web setup](../WEB-SETUP.md).
