# SLINK API & Data Terms of Service

**Shared Live Intelligence NetworK**  
Scripts - Shared Services - Data Infrastructure

**Operator:** Considious [3853023]  
**Faction:** [())))))] ("Slinky's") [46978]  
**Last Updated:** August 24, 2026

## Plain-language summary

These terms explain how SLINK tools use Torn API access, what information may
be stored or shared, how shared API capacity supports SLINK services, how
product permissions are assigned, and the additional rules that apply to API
keys specifically purchased for automated public-data collection.

## 1. Scope and Purpose

These Terms apply to scripts, browser extensions, shared services, databases,
and related Torn tools operated by Considious [3853023] under the SLINK -
Shared Live Intelligence NetworK - project. Some tools are faction-specific;
others may be available to current Slinky's [46978] members and individually
authorized users outside the faction.

The tools are intended to improve coordination, reduce unnecessary duplicate
API requests, provide useful shared intelligence, and support functions
including ranked-war targeting, retaliation alerts, leveling, market
monitoring, alerts, and statistical analysis.

By providing an API key to a tool covered by these Terms, the user authorizes
that tool to use the key and resulting API data only for the purposes disclosed
by these Terms and by the specific tool.

## 2. General API Policy

- Torn passwords are never requested.
- Ordinary user API keys are not remotely stored unless a specific tool clearly
  states otherwise and obtains authorization for that use.
- A key may be stored locally in the user's browser or userscript environment so
  an installed tool can perform authorized Torn API requests.
- A key may be transmitted temporarily when required to verify Torn identity,
  determine current faction membership, or perform an authorized request,
  without being persistently stored by the shared service.
- API-derived information may be retained after the request that produced it
  when that information is part of the disclosed shared service.
- SLINK uses Limited Access as its standard general-purpose key level where
  required. Individual tools will request only the selections they need, and
  some tools may function with Minimal Access. Full Access is never required.
- Purchased API keys are a separate category and are restricted to Public
  access as described later in these Terms.

## 3. Shared Service Participation and API Contribution

Some SLINK tools depend on shared information. Use of those tools may therefore
require a minimal contribution of API capacity and/or observations to maintain
the live service.

Where a user's Torn permissions provide the selections required by a service,
the installed tool may contribute appropriate requests to that shared service.
If the user's Torn or faction position does not provide a required selection,
that user will not be required to contribute requests their key cannot perform.

Users of compatible SLINK tools may be asked, where practical, to voluntarily
contribute additional API calls toward compatible shared-service requests.
Users may be allowed to voluntarily raise their contribution limit to further
support the service. Controls reserved to `admin.*` may reduce the operator's
routine shared-service contribution to zero.

## 4. API Rate Management and Safety

Participating SLINK tools maintain a combined target ceiling of 60 Torn API
requests per minute per user across the Suite. Individual tools may use lower
configurable limits, and shared-service contributions are included within this
combined budget.

This ceiling is intentionally conservative and is designed to preserve
capacity for other Torn API use. Because users may also operate third-party
tools outside SLINK, the Suite cannot guarantee that its own ceiling will
prevent the user's total Torn API usage from reaching Torn's limits.

The service will attempt to minimize unnecessary requests by sharing cached
information, scheduling future checks when a target's state is already known,
coordinating requests between active clients, and distributing required checks
across participating users.

If Torn returns a rate-limit response, participating SLINK tools are intended
to suspend discretionary Torn API requests for approximately two minutes
before cautiously resuming.

## 5. Identity, Membership, and Product Authorization

A user's Torn API key may be transmitted temporarily to verify the user's Torn
ID and current faction. Successful identity verification does not by itself
grant access to every SLINK product.

SLINK product access is controlled by named scopes. A scope may be supplied by
an automatic faction grant or by an active direct grant assigned to a Torn user.
Direct grants may be permanent or time-limited and may originate from a
purchase, promotion, or manual operator assignment.

Current Slinky's [46978] members receive `slink.level` and `slink.war`
automatically and free of charge. A user outside Slinky's may receive either
product scope through an active direct grant. Leaving Slinky's removes the
automatic faction entitlement but does not cancel a separate active direct
grant.

`slink.war.faction` is not a purchased or manually assigned product. It is a
short-lived session capability added only when Torn confirms that the user's
current faction position can read faction attack reports. It does not grant
`admin.*` or access to unrelated SLINK products.

Other faction-specific services may remain exclusive to current Slinky's
members. Each product determines and enforces its own required scope.

The permissions service may retain Torn user IDs, faction-to-scope mappings,
granted scopes, grant source and status, validity dates, the granting operator,
an optional transaction or operator reference, and an operational note. It
does not store the user's Torn API key or payment-card information.

## 6. War Panel

The War Panel supports ranked-war targeting and shared enemy-faction
intelligence. It may use information visible on the ranked-war page the user
has manually loaded, together with authorized Torn API requests.

Enemy faction and player information gathered through authorized requests may
be cached and distributed to authorized Slinky's members so every member does
not need to independently request the same information.

| Disclosure | War Panel |
| --- | --- |
| Data Storage | Live target snapshots are temporary; the limited aggregate event counters described below may be persistent. |
| Data Sharing | Users with an active `slink.war` entitlement / shared War service. |
| Purpose | Ranked-war coordination, target selection, and competitive faction intelligence. |
| Key Storage | Ordinary user keys are not remotely stored; API-derived information may be shared. |
| Access | Active `slink.war` entitlement; Minimal or Limited API access depending on the contributed request. Full Access is not required. |

## 7. Retaliation Panel

The Retaliation Panel uses authorized Faction API information to process
faction attack reports in live order and distribute relevant retaliation
opportunities to authorized Slinky's members.

Live retaliation windows and attack-ID deduplication are temporary. Losses,
escapes, and successful attacks against an online current-war opponent may be
retained as time-bucketed counters rather than full per-attack history.

| Disclosure | Retaliation Panel |
| --- | --- |
| Data Storage | Live retals and deduplication are temporary; disclosed aggregate counters may be persistent. |
| Data Sharing | Users with an active `slink.war` entitlement and the service operator. |
| Purpose | Retaliation coordination and non-malicious statistical analysis of faction combat activity. |
| Key Storage | Ordinary user keys are not remotely stored; derived faction data may be stored/shared. |
| Access | Active `slink.war` entitlement; contributing faction attack checks additionally requires the temporary `slink.war.faction` capability. |

## 8. Leveling Target Service

The Leveling Target Service is designed to identify useful leveling targets
while reducing competition and unnecessary API usage. It may combine
established leveling lists, Slinky's target information, API observations, and
information observed from Torn pages that users manually visit.

Shared information may include target status, hospitalization history,
activity indicators, Federal Jail or Hiding Out status, Fair Fight estimates,
competition measurements, scheduling information, and other data reasonably
necessary for target selection.

Observations may be synchronized between clients authorized for `slink.level`
so users benefit from information already collected by other participants. The
service may coordinate API work between active clients and distribute target
recommendations to reduce unnecessary competition between Leveling users.

| Disclosure | Leveling Target Service |
| --- | --- |
| Data Storage | Persistent shared target intelligence and event history. |
| Data Sharing | Users with an active `slink.level` entitlement / shared Leveling service. |
| Purpose | Efficient leveling, target discovery, competition reduction, and coordinated API scheduling. |
| Key Storage | Ordinary user keys are not remotely stored. |
| Access | Minimal or Limited Access, depending on the information required by the service. |

## 9. Purchased API Keys

Some API keys may be voluntarily sold or otherwise explicitly provided for
dedicated automated data-collection purposes. Purchased API keys are different
from purchased access to a SLINK product.

Only Public-access API keys will be purchased or accepted for automated
collection. Before compensation is accepted, the key owner must be informed
that the key will be stored and used for automated public-data collection.
Purchased keys may be securely stored by the service and used independently of
whether the key owner is actively using a SLINK script.

Permitted uses may include market monitoring, bazaar monitoring, public player,
faction or company cataloguing, leveling-target discovery, statistical
analysis, historical datasets, and distribution of public-data workload across
SLINK services.

Purchased keys will not be used to retrieve private information requiring
Minimal, Limited, Full, or other private permissions.

| Disclosure | Purchased API Keys |
| --- | --- |
| Data Storage | Persistent. |
| Data Sharing | Service operator; derived public information may be shared with authorized SLINK services/users. |
| Purpose | Public-data collection, market monitoring, target discovery, cataloguing, statistical analysis, and service operation. |
| Key Storage | Purchased Public keys may be securely stored for disclosed automated use; the key itself is not distributed to users. |
| Access | Public only. |

## 10. Purchased or Granted Product Access

Purchasing or receiving access to a SLINK product grants only the named product
scope for the stated period. It does not sell or transfer an API key, grant
administrative authority, or authorize data uses beyond the product disclosures
in these Terms.

An expired or revoked direct grant prevents new product authentication unless
the user also qualifies through an active faction grant. Existing signed
sessions may remain usable until their stated short expiration.

## 11. Data Aggregation and Deduplication

Information contributed by multiple users may be combined into aggregate
datasets. The service may deduplicate observations so multiple clients
reporting the same event do not artificially inflate statistics.

Aggregated information may be used to improve scheduling, target
prioritization, competition estimates, faction tools, market or public-data
tools, and other functionality described by these Terms.

## 12. Security and Revocation

- API keys will never intentionally be exposed to other users.
- Ordinary user keys will not be remotely retained unless a specific service
  clearly discloses that behavior and obtains authorization.
- Purchased Public API keys are the primary exception and may be securely
  stored for the automated uses specifically disclosed above.
- Users may revoke or replace their Torn API key at any time through Torn.
- Access to a scope-protected service may end when a required faction or direct
  grant is no longer active.

## 13. Tool-Specific Disclosures

This document provides the blanket terms for SLINK. Each tool that requests an
API key should also present a concise tool-specific disclosure at or near the
point where the key is supplied, identifying the relevant data use,
storage/sharing behavior, purpose, and required access level.

If a tool introduces materially different API permissions, persistent key
storage, a new category of shared data, or a substantially different purpose
of use, that behavior should be disclosed before the new use is implemented.

## 14. Changes to These Terms

These Terms may be updated as SLINK and its shared services develop. Material
changes involving new API permissions, storage of ordinary user API keys, new
categories of shared data, or substantially different uses of contributed API
information will be disclosed before those new uses are implemented.
