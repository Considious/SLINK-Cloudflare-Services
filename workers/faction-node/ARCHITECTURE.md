# Faction Node V1 architecture

## Deployment units

`worker.js` routes HTTPS and WebSocket requests. `FactionDirectory` stores faction room configuration, explicit Leaders, bounded audit entries, link invitations and pending room propagation in its own SQLite-backed Durable Object storage. `ChatRoom` is one SQLite-backed Durable Object per room, using the hibernation WebSocket API, attachments for transient connection state, and alarms only for actual scheduled work. No room/history polling is used.

`central.js` is imported by the existing contribution Worker. It uses the existing verified permission session for identity, the existing permissions database for licensing, and two new small registry tables. It never receives chat message contents. A chat-specific P-256 signing key separates customer verification from existing SLINK permission-session secrets.

## Public node endpoints

| Endpoint | Access |
| --- | --- |
| GET `/health` | Safe public product/version/protocol/node status |
| GET `/api/node/certificate` | Public Central-signed node identity |
| GET `/api/rooms` | Current faction member; only accessible rooms |
| GET `/api/rooms/:id/history?before=seq` | Current member with room read permission; 50 messages/page |
| GET `/api/rooms/:id/socket` | Same room access; WebSocket upgrade |
| GET/POST `/api/admin` | Explicit local Chat Leader |
| GET `/api/admin/diagnostics` | Leader; room connection counts and pending deliveries |
| POST `/api/links/invite`, `/approve`, `/revoke` | Leader |
| POST `/api/federation/accept` | Central-certified peer plus signed approval |
| POST `/api/federation/events`, `/revoke` | Exact active link and per-link signature |

For HTTP, send `Authorization: Bearer <chat token>`. WebSocket protocols are `slink.chat.v1` and `slink.token.<chat token>`; the server negotiates only `slink.chat.v1`. Do not log request authorization/subprotocol headers. The Worker overwrites internal identity headers before forwarding a socket/history request; clients cannot inject their own identities.

## Central endpoints

- GET `/api/chat/verification-key`: public protocol/issuer/key.
- POST `/api/chat/setup-token`: existing Central administrator, faction license required.
- POST `/api/chat/register`: one-use setup token and signed node ownership proof.
- POST `/api/chat/renew`: current registered private node key proof and license required.
- POST `/api/chat/revoke`: existing Central administrator.
- GET `/api/chat/discover`: existing verified permission session and faction license.
- POST `/api/chat/token`: same, with identity checked within five minutes.
- GET `/api/chat/members`: last verified faction roster for the administration picker; this cached roster does not authenticate or admit members.

## Administration commands

POST `/api/admin` takes `action` plus its fields. Actions: `room.create`, `room.update`, `room.archive`, `member.set`, `member.remove`, `leader.set`.

Room access modes: `faction`, `selected`, `leaders`. `member.set` accepts `user_id`, `role` (`member`/`moderator`), `can_read`, `can_speak`, `muted`, `muted_until`, `blocked`, `blocked_until`, `access_until`. Expiries are UTC epoch milliseconds up to a year ahead, or null for no expiry. Partial changes preserve previous settings. Adding a mute-only override to an unassigned selected-room user does not grant access. `member.remove` removes the override, not the user's faction membership. The intended frontend shows names and duration choices, not these field names.

Writes are serialized and persisted before room configuration propagates. A pending-propagation list survives an interrupted sync. The next request repairs outstanding propagation before proceeding. Failed validation or persistence reloads the stored state, preventing a half-applied in-memory edit. Directory RPC explicitly serializes expected errors because RPC does not preserve custom Error fields.

## WebSocket protocol 1

Every server event has `protocol:1`. Client commands:

- `send`: stable `client_id` plus `{type:'text'|'reply'|'media', text, reply_to?, url?, provider?}` content. Retry the same ID only for the same message.
- `edit`/`delete`: `message_id`, optional `command_id`, and content for edits.
- `typing`: transient, throttled, expires after five seconds.
- `read`: monotonic local room sequence; clients should debounce and send only when it advances.
- `auth`: a fresh Central token for the same account/faction. Renews the existing socket without rebuilding its window or losing history/drafts. Different identities require reconnecting.

Events include `welcome` (recent history, access and presence), `message`, `ack`, `message_update`, `action_ack`, `presence`, `typing`, `read_ack`, `auth_ack`, `access`, `access_revoked`, `delivery_pending`, `delivery_confirmed`, `delivery_failed`, and `error`. A local `ack` means persisted locally, not that every linked node has received it. Clients must reconcile messages by `message_id` and revision; sender broadcast plus ack is not two messages.

## Client integration still to implement

Reuse the existing permission-session service, existing theme tokens and media picker/renderer. Add a separate shared Faction Node client rather than overloading the existing Torn faction-message composer helper. Discover the endpoint; never hardcode faction node addresses. Keep access tokens in memory, refresh the verified identity before expiry, and renew sockets rather than rebuilding UI.

Extension sockets/transport must respect active-tab ownership and Torn CSP through its existing background architecture. PDA must respect active app/page lifecycle. Stop scraping hidden/inactive pages; do not remove already-rendered chat content on blur. Use a narrowly scoped observer only to attach owned controls when Torn mounts/replaces its chat row. No full-document scan timer.

Use `#chatRoot` with the actual user-provided bottom-row anchors (`people_panel_button`, `slink_extension_chat_button`, `notes_settings_button`). Add own room windows/buttons; do not clone Torn's React handlers, use its private chat transport, or overwrite native conversations. Backend events should patch message/access state, not replace focused inputs, scroll positions or the whole room window.
