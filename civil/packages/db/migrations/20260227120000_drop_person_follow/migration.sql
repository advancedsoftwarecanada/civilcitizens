-- Drop the legacy person-follow table.
-- People can no longer follow other people; only organizations/communities support follows.

DROP TABLE IF EXISTS "Follow";
