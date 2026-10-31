# Candidate 40: useful error messages

Scope: extension, PDA and Cloudflare Services, all on audit/test-foundation. Main and live databases are unchanged. This pass does not attempt to create artificial failures on production accounts.

## What changed

One presentation policy is shipped in each repository: extension src/core/errors.js, PDA src/00-errors.part, services workers/shared/errors.js. Existing client formatters delegate to it. Error status sinks retain their existing nodes and set text; they do not rebuild editors. HTTP helpers retain provider, HTTP status and retry information. The extension message bridge carries that safe metadata, not entire provider payloads. PDA native, GM and fetch transports use the same presentation and preserve native-origin fallback. Malformed successful JSON responses now fail explicitly rather than silently looking like empty data.

All four service JSON boundaries (access/contribution, Leveling, War, Mugging) add user_message and error_code for failures. Legacy error fields and HTTP statuses remain compatible. Success bodies are untouched. Internal worker logging/classification is not replaced by user-facing wording.

Additional bypasses covered: custom-chat alerts, media-picker error status, stored Mugging synchronization errors when displayed, shared dashboard/shell status and PDA module errors. PDA's small launcher supplies a standalone short startup explanation because a failed download cannot rely on the runtime formatter. Raw failure details remain diagnostic logs; user-visible text masks labeled credentials.

Weaver previously inferred minute limits for unknown 429s. Unknown periods now remain unknown; explicit daily and local minute-budget cases still distinguish themselves. Existing scheduling/backoff duration is retained. PDA retains the known/unknown cooldown reason; no new API calls or polling were introduced.

## User-facing distinctions

- Device storage full: not an API cap; recent saves may have failed; back up before removing cached data.
- Explicit server D1/R2 daily allowance: administrator/usage review.
- Missing schema/database/binding/service address: deployment/setup review, not replacing the user's key.
- Explicit daily request allowance: daily reset and lower-priority watches.
- Explicit minute request budget: wait/next cycle.
- Unspecified rate limit: reset period unknown, with approximate retry delay only if supplied.
- Unspecified resource quota: do not assume storage versus request capacity.
- Key verification pending versus explicitly rejected key versus expired SLINK session: different next steps.
- Browser site permission versus feature/faction scope: different owners.
- Current terms not verified: reverify, report if already accepted; do not clear settings.
- HTTP 5xx, connection refusal, timeout, browser blocking and unreadable JSON: separate explanations.
- Incompatible runtime/component and stale extension connection: update/reload guidance.
- Existing actionable validation messages are retained. Unclassified errors are not assigned invented causes.

Support references identify categories, not unique incidents. Existing retry timing, permissions, formulas, storage keys, settings and acceptance fingerprints remain intact. The policy is not proof that every future provider error has a known explanation; new cases can be added centrally.

## Verification

116 client commands pass. New tests cover 36 representative inputs, safe redaction, repeated formatting, unchanged original errors, successful payload identity and retained numeric provider codes. Integration tests cover actual extension HTTP and messaging helpers, HTML 502 responses, provider API error objects, unknown Weaver classification, PDA native/GM/fetch requests, malformed JSON and native-to-GM fallback.

93 worker/pipeline tests pass with no skips, including four actual-client Mugging round trips. Worker-boundary tests use the real JSON response functions and verify status/headers/legacy fields/successful sessions. A stale Leveling test referenced a nonexistent 2026-10-20 local policy file and hashed the display summary as though it were the full policy; its fixture now uses the existing 2026-08-23 unified policy file/full-document fingerprint, consistent with the worker. No production policy changed. Newly fetched unchanged support files are not published as changes.

PDA source digest rebuilt; launcher remains a small external-source loader (18,261 bytes measured, not an asserted device limit). No bundle/compression redesign. Physical PDA, actual provider outages and production storage exhaustion remain manual acceptance work; never fill or clear a real user's storage to test this.

See the single TESTER-CHANGELOG.md Candidate40 for installs and the plain-English break-it checklist.
