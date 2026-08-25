# SLINK API Key Donation Terms

**Version:** 2026-08-23  
**Effective date:** August 23, 2026

## What you are donating

You may voluntarily donate a Torn API key with **Public Only** access to the
Shared Live Intelligence NetworK (SLINK). SLINK will reject keys that report a
more privileged access level. Donation is optional and is separate from access
to any individual SLINK product.

## Remote storage and use

Unlike a key used only by a browser extension, a donated key is stored remotely
so SLINK can use it while your browser, computer, or mobile device is offline.
The key may be used by current and future SLINK systems for supported Torn API
requests that require no more than Public Only access.

The plaintext key is transmitted to the SLINK Contribution Service when you
donate or replace it. The service validates the key with Torn, encrypts it
before database storage, and decrypts it only inside the Contribution Worker
when performing an authorized request. SLINK product modules do not receive the
plaintext key.

## Your API key is private

Donated API keys are securely encrypted and cannot be viewed through SLINK's
database, extension, or administration tools, including by SLINK's owner.

Keys are used only for approved Public Only Torn API requests. They are never
displayed, shared with other SLINK tools, or stored in a readable form.

If SLINK's encryption system is ever reset, existing donated keys become
permanently unusable and must be donated again.

## Stored records

SLINK stores the encrypted key material, encryption version, Torn user ID,
reported key access type, donation-terms version and fingerprint, acceptance
time, status, validation and usage timestamps, failure counts, and a one-way
hash of a random management token. The management token is stored locally by
the extension and is not recoverable from the database.

SLINK may also store queued contribution-job metadata and public API results
needed to deliver SLINK services. SLINK does not intentionally use donated keys
to request private Torn data.

## Scheduling and limits

The Contribution Service may use an active donated key on a recurring schedule
without another action from you. SLINK will apply service-side pacing, bounded
job batches, supported-request allowlists, failure handling, and key rotation
across donors. Donation does not guarantee that a key will be used at any
particular frequency.

## Revocation and replacement

You may revoke your donation through the SLINK extension. Revocation removes
the encrypted key material and prevents future scheduled use. Work already in
progress may finish. You may replace the donated key by completing donation
again with a valid Public Only key and accepting the then-current terms.

If the local management token is lost, donating the same valid key again will
issue a replacement management token. SLINK may automatically disable a key
that becomes invalid, exceeds repeated failure limits, or no longer reports
Public Only access.

## Security limitations

SLINK uses application-level authenticated encryption and a Cloudflare Worker
secret kept separately from the database. No online system can promise that a
credential will never be exposed. Donate only a Public Only key, revoke it if
you suspect compromise, and rotate it through Torn when appropriate.

## Changes

A materially changed donation purpose, storage practice, or data-use policy
requires a new version of these terms and a new explicit acceptance before a
new or replacement donation is stored.
