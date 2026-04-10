-- Add role tracking timestamps to whitelist_users
-- Records when a user gained/lost their qualifying Discord role
-- for subscription duration tracking on the player detail page.

ALTER TABLE "whitelist_users" ADD COLUMN "role_gained_at" TIMESTAMP(3);
ALTER TABLE "whitelist_users" ADD COLUMN "role_lost_at" TIMESTAMP(3);
