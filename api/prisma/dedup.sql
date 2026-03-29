-- Remove duplicate role_mappings, keeping the lowest id per (guild_id, whitelist_id, role_id)
DELETE FROM role_mappings
WHERE id NOT IN (
  SELECT MIN(id)
  FROM role_mappings
  GROUP BY guild_id, whitelist_id, role_id
);

-- Remove duplicate whitelist_identifiers, keeping the lowest id per unique key
DELETE FROM whitelist_identifiers
WHERE id NOT IN (
  SELECT MIN(id)
  FROM whitelist_identifiers
  GROUP BY guild_id, discord_id, whitelist_id, id_type, id_value
);
