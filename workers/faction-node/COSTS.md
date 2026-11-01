# Usage and cost expectations

These are planning estimates, not a measured bill or a guarantee. Other services in the customer's Cloudflare account share its allowances.

The design uses hibernating sockets, no chat polling, one local history insert per message, compact read cursors, and one delivery per linked room rather than per remote recipient. It does not copy GIF/image files into storage. Long-idle rooms do not need a keepalive loop. Access renewal is still required approximately every five minutes; the `auth` socket command avoids rebuilding connections merely to renew authorization.

Cloudflare currently lists SQLite Durable Objects on Free and Paid. Its Free allowances include 100,000 DO requests/day, 5 million SQLite row reads/day, 100,000 row writes/day and 5 GB total storage. Incoming WebSocket messages have a 20:1 billing ratio; outgoing broadcasts are not billed as WebSocket requests. Free limits stop affected operations rather than allowing unlimited use. Review the [current pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) before deployment.

## Example faction — explicit assumptions

Suppose 20 users each have one room connected for eight hours/day, the faction sends 3,000 messages/day, and clients send 10,000 combined typing/read/renewal events/day:

- 13,000 incoming socket events/day would be about 650 metered DO requests/day for those events alone.
- Messages create roughly 3,000 local inserts/day; read cursor updates, indexes, moderation, retention, configuration and alarms add work. Row billing is not simply one write per message.
- If a five-minute identity window is fully used, 20 users × 8 hours × 12 checks/hour = around 1,920 Central identity/token refresh opportunities/day. Client sharing/caching should prevent multiplying these by the number of rooms. This is separate from customer DO usage and still needs client-side validation.
- Every actual reconnect/list/history/admin request adds Worker/DO work. The current router also consults its directory, so counting socket events alone underestimates total requests.
- One active cross-faction link adds approximately one outbound HTTP delivery and one remote inbox/history operation per forwarded event, with at most three attempts when unavailable.
- At an illustrative average of 1 KB per stored message, 30 days at 3,000/day is roughly 90 MB of message content before indexes/SQLite overhead. The default per-room sequence cap may retain less. This estimate is not an exact disk-size prediction.

A modest faction may fit the free allowances, but that is **not yet proven by deployment measurements**. Repeated reconnects, many history downloads, multiple rooms per user, hostile traffic, external media traffic and other account services can change the result. Before rollout, measure request totals, row reads/writes and hibernation duration on a test account. The customer owns billing and should configure appropriate Cloudflare monitoring/alerts.
