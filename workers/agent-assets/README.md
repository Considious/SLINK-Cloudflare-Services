# SLINK agent artwork upload API

This Worker has one R2 binding, to the private `slink-graphics-assets` bucket.
The API only accepts WebP, PNG and JPEG uploads of up to 4 MiB. It checks
the file signature and verifies the SHA-256 in the object key before writing.
Uploads are create-only. Repeating an upload safely returns the existing upload
result when the stored metadata matches.

## One-time setup

1. Confirm the `slink-graphics-assets` bucket exists and its public access is disabled.
2. Connect a Worker named `slink-agent-assets` to this repository with the project root
   `workers/agent-assets`, build command `npm test`, and deploy command
   `npx wrangler deploy`. The checked-in configuration supplies the R2 binding.
3. Generate a random 32-byte token as 64 lowercase hex characters in your
   credential store. Save the SHA-256 of that exact token string as the Worker
   secret `ASSET_UPLOAD_TOKEN_SHA256`. Keep the original token in the credential
   store used by the authorized upload client.
4. Supply the client environment variables `SLINK_ASSET_UPLOAD_URL` (the
   Worker HTTPS origin) and `SLINK_ASSET_UPLOAD_TOKEN` from that credential store.
   Rotate the token by replacing its hash in the Worker secret and updating
   the client credential. Never put the original token in Git or chat.

## Upload artwork

```text
npm run upload -- <path-to-image> assets/companions/jack-o-slink/animations
```

Omit the namespace to upload a versioned legacy asset to the bucket root.
The client computes the hash and prints the resulting key and byte count.
Names should be lowercase and dash-separated.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/v1/health` | Confirms the token and configured binding |
| PUT | `/v1/assets/<object-key>` | Uploads a raw image and returns its SHA-256 and key |

Send `Authorization: Bearer <token>` and the matching image MIME type.
Object keys end in `name.<sha256>.<extension>`. The supported namespaces are
`assets/themes/<pack>` and `assets/companions/<pack>`, with an optional
`animations`, `effects`, or `artwork` subfolder.
HTTP 201 means created, HTTP 200 means already present, and HTTP 409 means the
existing object's metadata does not match. The uploader never replaces that object.

This credential allows uploads only. Production asset delivery and entitlement
checks stay on the serving Worker. Torn API research uses a separate approval
and credential flow.
