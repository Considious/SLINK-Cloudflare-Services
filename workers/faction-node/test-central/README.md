# Test Central deployment

Cloudflare build root: `workers/faction-node/test-central`.

- Branch: `feature/faction-node-v1`
- Build: `npm ci`
- Deploy: `npx wrangler deploy`

Keep the existing test D1 binding and runtime secrets. This deployment includes the hosted test-node registration route needed by the node's Finish setup button. See [the complete web setup](../WEB-SETUP.md).
