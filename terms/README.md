# SLINK Terms of Service, Privacy & API Data Policy

SLINK uses one policy for the browser extension, PDA userscript, shared
Cloudflare services, remote settings backup, third-party integrations, and
donated Public Torn API keys.

## Current policy

| Version | Effective date | Public link | SHA-256 |
|---|---|---|---|
| `2026-10-20` | October 20, 2026 | [SLINK policy](2026-08-23/SLINK_API_Data_Terms_of_Service.md) | `4386e2c662f273d7e89fbe803cc4e7038496d5b3f8eeab95eb44da137746f3a0` |

The public path intentionally remains stable so every SLINK client can use the
same link. Enforcement uses both the policy version and SHA-256 fingerprint;
changing either requires renewed acceptance.

## Historical policies

| Version | Archived document | SHA-256 |
|---|---|---|
| `2026-08-24` | [Archived August 24 policy](2026-08-24/SLINK_API_Data_Terms_of_Service.md) | `72a933d69ec99cabeb92b426208e9d0c47e90acaf960818e0b4da38f3f2f5b0a` |
| `2026-08-14` | [Markdown](2026-08-14/SLINK_API_Data_Terms_of_Service.md) · [DOCX](2026-08-14/SLINK_API_Data_Terms_of_Service.docx) | See that release's worker metadata |

## Release procedure

1. Archive the outgoing stable document under its effective version.
2. Update the stable policy document.
3. Compute its SHA-256 fingerprint from the exact UTF-8 file bytes.
4. Update every enforcing Worker and client fallback to the new version and fingerprint.
5. Deploy the Workers and publish the clients.
6. Users must explicitly accept the new policy before new authenticated sessions are issued.
