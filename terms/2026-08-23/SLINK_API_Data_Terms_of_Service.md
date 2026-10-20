# SLINK Terms of Service, Privacy & API Data Policy

**Shared Live Intelligence NetworK (SLINK)**  
Browser Extension · PDA Userscript · Shared Services · Data Infrastructure

**Operator:** Considious [3853023]  
**Faction:** [())))))] ("Slinky's") [46978]  
**Policy version:** 2026-10-20  
**Effective date:** October 20, 2026  
**Last updated:** October 20, 2026

## Plain-language summary

SLINK is a collection of optional tools for Torn. It uses a Torn API key, data
from Torn pages that the user manually opens and actively views, locally saved
settings, and selected shared SLINK services.

Ordinary user API keys are saved only on that user's device. They may be sent
temporarily to Torn or a SLINK authentication endpoint when a request needs to
verify identity, faction membership, permissions, or retrieve authorized data.
They are not persistently stored by SLINK's shared services.

Some API-derived information is intentionally shared, including war,
retaliation, leveling, mugging, bounty, faction-officer, and market
intelligence. A user can see which modules are enabled and can disable optional
features where controls are provided.

Settings backups are optional recovery copies stored by SLINK and do not include
Torn API keys or third-party provider keys. Donated Public Torn API keys are the
only API keys SLINK intentionally stores remotely; they require a separate
explicit action by the key owner but are governed by this same policy.

## 1. Agreement and relationship to Torn

These Terms apply to the SLINK browser extension, PDA userscript, dashboard,
Cloudflare Workers, databases, object storage, GitHub-hosted assets, and related
services operated by Considious [3853023].

SLINK is an independent community tool and is not operated, endorsed, or
warranted by Torn. Torn's rules, scripting rules, API Terms of Service, and API
limits always take priority. If any SLINK behavior conflicts with a Torn rule,
that behavior must be disabled or corrected.

Using SLINK or supplying an API key means the user authorizes the uses described
in this policy. Users who do not agree must not authenticate or enable SLINK
services.

## 2. Torn scripting and page-access rules

SLINK is designed to comply with Torn's rules for scripts, addons, extensions,
and tools:

- Automated or scheduled Torn requests use the official Torn API.
- DOM information is read only from a Torn page the user manually loaded and is
  actively viewing.
- SLINK must not automatically make non-API Torn requests, scrape Torn pages
  that are not actively viewed, monitor unfocused pages for new Torn data,
  bypass CAPTCHA protections, or simulate unattended gameplay.
- A user-initiated helper may fill, highlight, confirm, navigate, or perform the
  specific action the user selected. SLINK does not authorize unattended
  automation.
- Race recommendations highlight a car but do not select it automatically.
- Safety confirmations, chat helpers, and similar features require a deliberate
  user action for the protected or final action.
- Malicious, concealed, or materially undisclosed functionality is prohibited.

## 3. API key rules

- SLINK never asks for a Torn password.
- Ordinary Torn API keys are stored locally in the browser extension or PDA
  userscript storage.
- Ordinary keys may be transmitted temporarily to Torn and to the relevant
  SLINK service to authenticate the user, confirm faction membership or role,
  obtain authorized API data, or carry out a disclosed module request.
- Ordinary keys are not written to SLINK databases, object storage, logs, or
  analytics.
- Full Access keys are not required. SLINK generally uses Minimal, Limited, or
  Custom access depending on the enabled module and requested Torn selection.
- SLINK should request only the selections needed for the enabled feature and
  should cache or coordinate results where practical to avoid unnecessary API
  calls.
- Users may replace or revoke a key through Torn at any time. Removing the key
  from SLINK prevents new authenticated requests from that device.
- A custom key must be treated with the same care as a Full Access key, in
  accordance with Torn's guidance.

## 4. Required Torn API disclosure

| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
| --- | --- | --- | --- | --- |
| Local settings and API results may persist on the user's device. Shared-service data may be temporary or persistent as described below. Optional settings backups persist until replaced or deleted. | The user; authorized faction members or SLINK users for shared modules; the operator where required to run or support the service; third-party providers only when that integration is used. | Alerts, combat and faction coordination, target discovery, Fair Fight estimation, market and travel assistance, efficiency and quality-of-life tools, service security, troubleshooting, and non-malicious statistical analysis. | Ordinary keys: stored locally and transmitted temporarily, never persistently stored by SLINK. Donated Public keys: stored remotely for the disclosed public-data service. | Minimal, Limited, or Custom selections as required. Full Access is not required. Donated keys must be Public access only. |

The sections below explain the storage, sharing, and purpose for each category.

## 5. Local-only and device features

Local features include interface preferences, alert toggles, panel size and
position, saved module state, racing builds and nicknames, chat buttons and
highlight terms, safety confirmations, and other device-specific preferences.

Torn API results used only for the current user's private display may be cached
locally to reduce repeat requests. Local data remains accessible to anyone who
can access that browser or PDA storage.

## 6. Authentication, permissions, and faction grants

SLINK temporarily uses the user's key to verify Torn identity, current faction,
and available API access. The permissions service may persist:

- Torn user ID and verified faction ID or faction position;
- direct, faction, role, and administrative scope grants;
- grant source, status, dates, operator, notes, and audit metadata;
- current policy acceptance version, fingerprint, and acceptance time; and
- short-lived signed session identifiers and security metadata.

The permissions service does not persist the ordinary Torn API key.

A feature may be available through an individual grant, faction grant, role
grant, or administrative scope. Grants control SLINK access only and do not
alter Torn permissions.

## 7. Shared combat and target intelligence

War, retaliation, leveling, mugging, bounty, target-list, and stakeout features
may share information among users authorized for the relevant scope. Shared
data can include public or authorized player and faction details, current
status, hospitalization timing, activity indicators, attack or retaliation
opportunities, target history, Fair Fight or battle-stat estimates, competition
measurements, scheduling information, and deduplication identifiers.

Live alerts and coordination records may be temporary. Target intelligence,
estimates, historical observations, aggregate counters, scheduling state, and
service-quality measurements may persist so every user does not have to repeat
the same request.

Fair Fight estimates may use FFScouter or another disclosed provider. Data sent
to that provider is subject to its own terms and availability.

## 8. Faction officer and administration features

Faction onboarding, equipment verification, Armory Recaller, armory thresholds,
organized-crime supply checks, company/director tools, and officer alerts may
use faction information the authenticated user is permitted to access.

Relevant membership, position, verification, inventory threshold, organized
crime, and alert state may be shared with authorized faction officers and
administrators. An officer verification can synchronize across officer
profiles. Administrative users may retain separate verification visibility for
testing and oversight.

## 9. Alerts, efficiency, and quality-of-life modules

SLINK may use authorized API data for cooldowns, energy, nerve, travel, racing,
crime unique opportunities, missions, merits, company information, property and
bank information, stock benefits, organized crime timing, museum sets, events,
market watches, bazaar watches, and similar alerts or summaries.

Alert preferences and dismissals are stored locally unless a feature expressly
uses shared state. SLINK may continue an active module briefly after the user
leaves its tab to prevent ordinary navigation from interrupting work. Users can
disable supported modules and alerts.

DOM-based features operate only on currently viewed Torn pages. They must not
turn a manually viewed page into an unattended Torn scraper.

## 10. Market, bazaar, travel, and abroad-stock data

Market and bazaar tools may compare Torn market values, visible listings,
configured thresholds, and shared public market observations. Abroad Stocks may
use YATA, Prometheus, Torn Intel, or other providers shown in the interface.

Third-party integration is optional or dependent on provider availability.
Provider keys, when required, are stored locally and sent to the selected
provider. SLINK does not guarantee third-party accuracy, uptime, restock
estimates, market prices, availability, or continued API access. Users are also
subject to the provider's terms.

Market alerts and recommendations are informational. SLINK does not guarantee
profit, item availability, or that a listing remains available when opened.

## 11. Optional settings backup and recovery

SLINK may offer an authenticated remote backup of non-secret settings so a user
can manually restore configuration after device or storage loss.

Backups may include alert settings, target lists, watched items, module
preferences, racing builds, and similar configuration. Backups exclude Torn API
keys, donated-key material, and third-party provider keys.

A backup is not automatically restored over current local settings. Recovery
requires a deliberate user action. A newer backup may replace an older backup.
The operator's hosting provider stores the backup, and the operator may have
infrastructure access when needed for maintenance or support.

## 12. Donated Public API keys

A user may separately and voluntarily contribute a Torn API key for SLINK's
shared public-data workload. This is not required for ordinary SLINK use unless
the interface clearly states otherwise.

Only a Public-access key is accepted. The donated key may be encrypted and
stored remotely, used while the user's device is offline, and assigned to
allowlisted public Torn API requests. Uses may include public market, bazaar,
player, faction, company, target-discovery, cataloguing, monitoring, and
statistical requests.

The raw donated key is not distributed to SLINK users. Derived public data may
be shared with authorized SLINK services and users. The donor can revoke the key
through Torn and may use SLINK's revocation control where available.

This section replaces the need for a separate donation policy: donating a key
is an explicit opt-in action governed by this same document.

## 13. API budgets and service protection

SLINK coordinates and limits requests across its modules. Individual modules
may have lower minute, daily, or activity-based budgets. When a budget is
reached, work may be queued, delayed, or skipped.

SLINK cannot account for requests made by unrelated tools using the same key.
Torn's API responses and limits remain authoritative. Cached results may be used
when fresh enough for the feature.

SLINK may suspend, throttle, or revoke service access to protect Torn, SLINK
infrastructure, users, or shared capacity.

## 14. Paid or granted SLINK access

Some SLINK scopes may be restricted, granted to selected factions or testers,
or offered for a fee. Any fee is for access to SLINK software or hosted
features—not for Torn currency, items, accounts, or ownership of a user's API
key.

Paid or donated features must remain subject to Torn's rules and any approval
Torn requires for charging users, accepting donations, or advertising. A SLINK
purchase does not create a guarantee of profit, uninterrupted access, or
continued compatibility with Torn.

## 15. Security, retention, deletion, and revocation

SLINK uses reasonable technical controls, scoped permissions, short-lived
sessions, request limits, and access checks. No online service can guarantee
perfect security or availability.

Users can revoke Torn keys through Torn, disable modules, remove local data,
revoke a donated key, and request deletion of attributable SLINK server data by
contacting Considious [3853023] in Torn. Some anonymized or aggregated records,
security logs, acceptance records, or records required for service integrity may
be retained where reasonably necessary.

If a user leaves a faction or loses a grant, faction-derived or direct access
may end. Existing short-lived sessions may expire or be invalidated.

## 16. Accuracy, availability, and user responsibility

SLINK data can be delayed, incomplete, estimated, or wrong. Users remain
responsible for confirming targets, prices, travel timing, organized crimes,
stock benefits, event guidance, alerts, and any action before relying on it.

SLINK is provided on an "as available" basis without a guarantee of
uninterrupted operation, continued Torn compatibility, financial return, combat
result, or preservation of local device storage.

## 17. Policy updates and renewed acceptance

Material policy changes receive a new policy version and document fingerprint.
SLINK may invalidate existing sessions and require every user to review and
accept the current policy before authenticating again.

The public policy link remains stable so installed clients and users can always
open the current policy. Historic acceptance records may be retained for audit
purposes.

## 18. Contact

Questions, deletion requests, or security concerns can be directed to
Considious [3853023] through Torn.

## Official Torn policies

SLINK is intended to follow the current official requirements published in:

- [Torn API documentation and API Terms of Service](https://www.torn.com/api.html)
- [Rules for Scripts, Addons, Extensions & Tools](https://www.torn.com/forums.php?a=0&b=0&f=67&p=threads&t=16037108)
