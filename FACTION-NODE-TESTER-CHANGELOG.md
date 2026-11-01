# Faction chat — what to test

Preview build for test faction 46978. The test chat backend is registered; use the feature-branch clients, not the normal release.

## What is being added

- Faction-owned rooms alongside Torn chat, including officers-only and selected-member rooms.
- Separate room access and speaking permission, with timed mutes and temporary restrictions.
- Replies, history, unread counts and editing/deleting your own messages.
- Leader/moderator controls and optional links with another consenting faction.
- Media messages using SLINK's existing GIF/sticker tools.
- Safer room-save retries, lighter typing updates and limits on repeated reconnect attempts during connection trouble.
- Cloudflare-hosted test setup: private node keys stay in Cloudflare, with no local launcher or secret copying.
- Faction Rooms now signs in to the test chat service separately, without changing your normal SLINK login or alert settings.

## Please try these

- Enable Faction Rooms under Quality of Life, then open Rooms in Torn's chat row. Your saved Torn key and existing terms acceptance should work without another key field or clearing settings.
- Confirm the assigned Chat Leader can manage rooms. A different faction member should be able to enter General but must not get management controls just because they have SLINK admin permissions.

- Minimize/reopen and switch away/back. The current room and unsent draft should remain on that page. Change Torn pages: the last room and open/minimized state should return after access is checked. Unsent text drafts are page-local; saved messages should load from the node.
- Try entering a room you were not assigned to; it should stay inaccessible.
- Have a Leader mute you while the room is open. Reading should work, sending should stop immediately, and the chosen expiry should restore it.
- Remove access while someone is connected. Reopening or changing devices must not bypass the restriction.
- Let temporary access expire. Check that it ends without manual cleanup.
- Change one permission and confirm other permissions stay unchanged.
- Reply, edit and delete your own messages. Changing another person's message without moderator permission should be refused.
- Reconnect after sending. Saved messages should remain, without duplicates.
- Interrupt a room save, then retry the same details. It should create only one room.
- Try an unstable connection. Chat should stop repeatedly reconnecting and offer a manual retry without clearing the conversation. If updates are sent too rapidly, wait a minute before reconnecting.
- Link two test factions. Both Leaders must approve; either can disconnect the link.
- Take the other test node offline. Local chat should continue and remote delivery trouble should be clear.
- Try themes, narrow screens, scrolling and normal Torn chat. Nothing should overlap controls or interrupt native conversations.
- After the node is deployed, finish setup on its web page. Reopening setup must preserve the same node and rooms; an unassigned administrator must not become a Chat Leader automatically.

Report what you clicked, what you expected, what happened, and extension or PDA. Never post API keys, private configuration, tokens or private conversations.
