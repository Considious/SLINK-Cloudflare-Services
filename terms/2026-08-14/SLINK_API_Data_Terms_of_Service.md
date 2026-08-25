# SLINK API & Data Terms of Service

**Shared Live Intelligence NetworK**  
Scripts • Shared Services • Data Infrastructure

**Operator:** Considious [3853023]  
**Faction:** [())))))] (“Slinky's”) [46978]  
**Last Updated:** August 14, 2026

## Plain-language summary

These terms explain how SLINK tools use Torn API access, what information may
be stored or shared, how shared API capacity supports faction services, and the
additional rules that apply to API keys specifically purchased for automated
public-data collection.

## 1. Scope and Purpose

These Terms apply to scripts, userscripts, shared services, databases, and
related Torn tools operated by Considious [3853023] for Faction [())))))]
(“Slinky's”) [46978] under the SLINK - Shared Live Intelligence NetworK -
project.

The tools are intended to improve faction coordination, reduce unnecessary
duplicate API requests, provide useful shared intelligence, and support
functions including ranked-war targeting, retaliation alerts, leveling,
market monitoring, alerts, and statistical analysis.

By providing an API key to a tool covered by these Terms, the user authorizes
that tool to use the key and resulting API data only for the purposes disclosed
by these Terms and by the specific tool.

## 2. General API Policy

- Torn passwords are never requested.
- Ordinary user API keys are not remotely stored unless a specific tool clearly
  states otherwise and obtains authorization for that use.
- A key may be stored locally in the user's browser or userscript environment so
  an installed tool can perform authorized Torn API requests.
- A key may be transmitted temporarily when required for authentication or an
  authorized request without being persistently stored by the shared service.
- API-derived information may be retained after the request that produced it
  when that information is part of the disclosed shared service.
- The SLINK uses Limited Access as its standard general-purpose key level where
  required. Individual tools will request only the selections they need, and
  some tools may function with Minimal Access. Full Access is never required.
- Purchased API keys are a separate category and are restricted to Public
  access as described later in these Terms.

## 3. Shared Service Participation and API Contribution

Some SLINK tools depend on shared information. Use of those tools may therefore
require a minimal contribution of API capacity and/or observations to maintain
the live service.

Where a user's faction permissions provide the selections required by a
faction service, the installed tool may contribute appropriate requests to
that shared service. If the user's faction position does not provide access to
the required Faction API selections, that user will not be required to
contribute requests their key cannot perform.

Members who use other SLINK tools are asked, where practical, to voluntarily
contribute approximately 10 additional API calls per minute toward compatible
shared-service requests. Users may be allowed to voluntarily raise their
contribution limit to further support the service.

## 4. API Rate Management and Safety

Participating SLINK tools maintain a combined target ceiling of 60 Torn API
requests per minute per user across the Suite. Individual tools may use lower
configurable limits, and shared-service contributions are included within this
combined budget.

This ceiling is intentionally conservative and is designed to preserve
capacity for other Torn API use. Because users may also operate third-party
tools outside the SLINK, the Suite cannot guarantee that its own ceiling will
prevent the user's total Torn API usage from reaching Torn's limits.

The service will attempt to minimize unnecessary requests by sharing cached
information, scheduling future checks when a target's state is already known,
coordinating requests between active clients, and distributing required checks
across participating users.

If Torn returns a rate-limit response, participating SLINK tools are intended
to suspend discretionary Torn API requests for approximately two minutes
before cautiously resuming. This circuit-breaker behavior is intended to avoid
repeatedly striking Torn's limiter after available API capacity has been
exhausted.

## 5. Slinky's Membership and Authorization

Faction-specific services are intended exclusively for current members of
Slinky's [46978]. A user's Torn API key may be used to verify current faction
membership, and membership may be periodically revalidated.

Leaving Slinky's may result in automatic loss of access to faction-restricted
services. Historical, aggregated, or target/faction intelligence previously
contributed to the service may remain where retention is part of the service's
disclosed purpose.

## 6. War Panel

The War Panel supports ranked-war targeting and shared enemy-faction
intelligence. It may use information visible on the ranked-war page the user
has manually loaded, together with authorized Torn API requests.

Enemy faction and player information gathered through authorized requests may
be cached and distributed to authorized Slinky's members so every member does
not need to independently request the same information.

| Disclosure | War Panel |
| --- | --- |
| Data Storage | Temporary and/or persistent, depending on the information collected. |
| Data Sharing | Authorized Slinky's members / shared faction service. |
| Purpose | Ranked-war coordination, target selection, and competitive faction intelligence. |
| Key Storage | Ordinary user keys are not remotely stored; API-derived information may be shared. |
| Access | Limited Access where required; Full Access is not required. |

## 7. Retaliation Panel

The Retaliation Panel uses authorized Faction API information to process
faction attack reports in live order and distribute relevant retaliation
opportunities to authorized Slinky's members.

Attack information may also contribute to persistent faction statistics and
analysis, including successful attacks, losses, defends, escapes, online
attacks, retaliation opportunities, and other combat statistics derived from
faction attack reports.

| Disclosure | Retaliation Panel |
| --- | --- |
| Data Storage | Persistent where required for faction statistics, event history, or analysis. |
| Data Sharing | Authorized Slinky's members and the service operator. |
| Purpose | Retaliation coordination and non-malicious statistical analysis of faction combat activity. |
| Key Storage | Ordinary user keys are not remotely stored; derived faction data may be stored/shared. |
| Access | Faction API selections available to the user's faction position; Limited Access where required. |

## 8. Leveling Target Service

The Leveling Target Service is designed to identify useful leveling targets
while reducing competition and unnecessary API usage. It may combine
established leveling lists, Slinky's target information, API observations, and
information observed from Torn pages that users manually visit.

Shared information may include target status, hospitalization history,
activity indicators, Federal Jail or Hiding Out status, Fair Fight estimates,
competition measurements, scheduling information, and other data reasonably
necessary for target selection.

Observations may be synchronized between authorized clients so members benefit
from information already collected by other Slinky's members. The service may
coordinate API work between active clients and distribute target
recommendations to reduce unnecessary competition between Slinky's members
themselves.

| Disclosure | Leveling Target Service |
| --- | --- |
| Data Storage | Persistent shared target intelligence and event history. |
| Data Sharing | Authorized Slinky's members / shared faction service. |
| Purpose | Efficient leveling, target discovery, competition reduction, and coordinated API scheduling. |
| Key Storage | Ordinary user keys are not remotely stored. |
| Access | Minimal or Limited Access, depending on the information required by the service. |

## 9. Purchased API Keys

Some API keys may be voluntarily sold or otherwise explicitly provided for
dedicated automated data-collection purposes. Purchased keys are treated
differently from ordinary member keys.

Only Public-access API keys will be purchased or accepted for this purpose.

Before compensation is accepted, the key owner must be informed that the key
will be stored and used for automated public-data collection. Purchased keys
may be securely stored by the service and used independently of whether the
key owner is actively using a SLINK script.

Permitted uses may include:

- Item market monitoring, historical market information, and market-watch
  services.
- Bazaar monitoring and alerts.
- Hall of Fame cataloguing and player discovery.
- Public player information and status/activity observations available through
  Public API access.
- Faction cataloguing and public faction information.
- Company cataloguing and public company information.
- Building and maintaining leveling-target datasets.
- Statistical analysis and historical datasets derived from Public API
  information.
- Distributing public-data API workload across SLINK services.

Purchased keys will not be used to retrieve private information requiring
Minimal, Limited, Full, or other private permissions.

| Disclosure | Purchased API Keys |
| --- | --- |
| Data Storage | Persistent. |
| Data Sharing | Service operator; derived public information may be shared with authorized Slinky's services/users. |
| Purpose | Public-data collection, market monitoring, target discovery, cataloguing, statistical analysis, and service operation. |
| Key Storage | Purchased Public keys may be securely stored for disclosed automated use; the key itself is not distributed to users. |
| Access | Public only. |

## 10. Data Aggregation and Deduplication

Information contributed by multiple users may be combined into aggregate
datasets. The service may deduplicate observations so multiple clients
reporting the same event do not artificially inflate statistics.

Aggregated information may be used to improve scheduling, target
prioritization, competition estimates, faction tools, market or public-data
tools, and other functionality described by these Terms.

## 11. Security and Revocation

- API keys will never intentionally be exposed to other faction members.
- Ordinary member keys will not be remotely retained unless a specific service
  clearly discloses that behavior and obtains authorization.
- Purchased Public API keys are the primary exception and may be securely
  stored for the automated uses specifically disclosed above.
- Users may revoke or replace their Torn API key at any time through Torn.
- Access to Slinky's-restricted services may be revoked when faction membership
  or required authorization is no longer valid.

## 12. Tool-Specific Disclosures

This document provides the blanket terms for the SLINK. Each tool that requests
an API key should also present a concise tool-specific disclosure at or near
the point where the key is supplied, identifying the relevant data use,
storage/sharing behavior, purpose, and required access level.

If a tool introduces materially different API permissions, persistent key
storage, a new category of shared data, or a substantially different purpose
of use, that behavior should be disclosed before the new use is implemented.

## 13. Changes to These Terms

These Terms may be updated as the SLINK and its shared services develop.
Material changes involving new API permissions, storage of ordinary user API
keys, new categories of shared data, or substantially different uses of
contributed API information will be disclosed before those new uses are
implemented.
