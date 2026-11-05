# Personal room grants

Apply permissions migration `0024-personal-room-tiers.sql` to the shared
`slink-permissions` database, and deploy the updated Chat Central and
Faction Node. Assign one explicit user grant, `slink.chat.personal.1`
through `slink.chat.personal.5`, in the permissions manager.
The highest active tier applies; grants do not stack. Neither wildcard
nor faction-level grants unlock this feature.

Personal rooms are hosted on the user's current licensed faction node
and limited to invited members of that faction. The quota is enforced on
that node; there is no cross-faction room hosting or quota ledger. Room
owners can rename, invite/remove faction members, and archive their own
rooms. Faction Chat Leaders do not gain automatic room access.

If a grant expires or is removed, the owner cannot create or change
rooms, but can archive them. Existing rooms are not automatically
deleted or closed. Downgrading a tier does not delete rooms; the owner
cannot create new rooms while at or above the new limit.

No checkout, real-money processing, or automatic permission assignment
is implemented. Confirm the intended sales and expiry policy before
offering these as a paid product.
