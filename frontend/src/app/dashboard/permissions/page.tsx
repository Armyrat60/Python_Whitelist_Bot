"use client";

import { useState } from "react";
import { Shield, Plus, Trash2, ChevronDown, Users, Tag } from "lucide-react";
import {
  usePermissions, useGrantPermission, useUpdatePermission, useRevokePermission,
  useRolePermissions, useGrantRolePermission, useUpdateRolePermission, useRevokeRolePermission,
  useRoles,
} from "@/hooks/use-settings";
import { useSession } from "@/hooks/use-session";
import type { PermissionLevel } from "@/lib/types";

const LEVEL_LABELS: Record<PermissionLevel, string> = {
  owner:          "Owner",
  admin:          "Admin",
  roster_manager: "Roster Manager",
  viewer:         "Viewer",
};

const LEVEL_DESCRIPTIONS: Record<PermissionLevel, string> = {
  owner:          "Full access — auto-detected from Discord guild ownership",
  admin:          "Full access — auto-detected from MANAGE_GUILD permission or mod role",
  roster_manager: "Can manage Manual Roster categories they are assigned to",
  viewer:         "Read-only access to the dashboard",
};

const LEVEL_BADGE: Record<PermissionLevel, string> = {
  owner:          "bg-purple-500/20 text-purple-300 border-purple-500/30",
  admin:          "bg-blue-500/20 text-blue-300 border-blue-500/30",
  roster_manager: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  viewer:         "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
};

const GRANTABLE_LEVELS: PermissionLevel[] = ["roster_manager", "viewer"];

export default function PermissionsPage() {
  const { data: session } = useSession();
  const { data: permissions, isLoading }     = usePermissions();
  const { data: rolePermissions, isLoading: roleLoading } = useRolePermissions();
  const { data: discordRoles }               = useRoles();
  const grant        = useGrantPermission();
  const update       = useUpdatePermission();
  const revoke       = useRevokePermission();
  const grantRole    = useGrantRolePermission();
  const updateRole   = useUpdateRolePermission();
  const revokeRole   = useRevokeRolePermission();

  const [showAddUser, setShowAddUser]         = useState(false);
  const [newDiscordId, setNewDiscordId]       = useState("");
  const [newDiscordName, setNewDiscordName]   = useState("");
  const [newUserLevel, setNewUserLevel]       = useState<PermissionLevel>("viewer");

  const [showAddRole, setShowAddRole]         = useState(false);
  const [newRoleId, setNewRoleId]             = useState("");
  const [newRoleLevel, setNewRoleLevel]       = useState<PermissionLevel>("viewer");

  const isAdmin = session?.is_mod ?? false;

  function handleGrantUser() {
    if (!newDiscordId.trim()) return;
    grant.mutate(
      { discord_id: newDiscordId.trim(), discord_name: newDiscordName.trim() || undefined, permission_level: newUserLevel },
      {
        onSuccess: () => {
          setNewDiscordId("");
          setNewDiscordName("");
          setNewUserLevel("viewer");
          setShowAddUser(false);
        },
      }
    );
  }

  function handleGrantRole() {
    if (!newRoleId) return;
    const role = discordRoles?.find((r) => r.id === newRoleId);
    grantRole.mutate(
      { role_id: newRoleId, role_name: role?.name, permission_level: newRoleLevel },
      {
        onSuccess: () => {
          setNewRoleId("");
          setNewRoleLevel("viewer");
          setShowAddRole(false);
        },
      }
    );
  }

  // Filter out roles already granted
  const grantedRoleIds = new Set((rolePermissions ?? []).map((r) => r.role_id));
  const availableRoles = (discordRoles ?? []).filter((r) => !grantedRoleIds.has(r.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Shield className="h-6 w-6 text-purple-400" />
          Permissions
        </h1>
        <p className="text-zinc-400 mt-1 text-sm">
          Control who can access the dashboard and what they can do.
        </p>
      </div>

      {/* Permission level legend */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.entries(LEVEL_LABELS) as [PermissionLevel, string][]).map(([level, label]) => (
          <div key={level} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded border ${LEVEL_BADGE[level]}`}>
                {label}
              </span>
            </div>
            <p className="text-xs text-zinc-500">{LEVEL_DESCRIPTIONS[level]}</p>
          </div>
        ))}
      </div>

      {/* ── By User ──────────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Users className="h-4 w-4 text-zinc-400" />
              By User
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Grant access to specific Discord users by their ID.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setShowAddUser((v) => !v); setShowAddRole(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add User
            </button>
          )}
        </div>

        {showAddUser && (
          <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Discord ID *</label>
                <input
                  type="text"
                  placeholder="123456789012345678"
                  value={newDiscordId}
                  onChange={(e) => setNewDiscordId(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Display Name (optional)</label>
                <input
                  type="text"
                  placeholder="Username"
                  value={newDiscordName}
                  onChange={(e) => setNewDiscordName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Permission Level</label>
                <div className="relative">
                  <select
                    value={newUserLevel}
                    onChange={(e) => setNewUserLevel(e.target.value as PermissionLevel)}
                    className="w-full appearance-none bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 pr-8"
                  >
                    {GRANTABLE_LEVELS.map((l) => (
                      <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-2.5 h-4 w-4 text-zinc-400 pointer-events-none" />
                </div>
              </div>
            </div>
            <p className="text-xs text-zinc-500">{LEVEL_DESCRIPTIONS[newUserLevel]}</p>
            <div className="flex gap-2">
              <button
                onClick={handleGrantUser}
                disabled={!newDiscordId.trim() || grant.isPending}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {grant.isPending ? "Granting…" : "Grant Access"}
              </button>
              <button
                onClick={() => setShowAddUser(false)}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">Loading…</div>
        ) : !permissions || permissions.length === 0 ? (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">
            No explicit user grants yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left">
                <th className="px-4 py-2 text-xs font-medium text-zinc-400">User</th>
                <th className="px-4 py-2 text-xs font-medium text-zinc-400">Level</th>
                <th className="px-4 py-2 text-xs font-medium text-zinc-400">Granted</th>
                {isAdmin && <th className="px-4 py-2 text-xs font-medium text-zinc-400 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {permissions.map((p) => (
                <tr key={p.discord_id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-200">{p.discord_name ?? "Unknown"}</div>
                    <div className="text-xs text-zinc-500 font-mono">{p.discord_id}</div>
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <div className="relative inline-block">
                        <select
                          value={p.permission_level}
                          onChange={(e) =>
                            update.mutate({ discordId: p.discord_id, permission_level: e.target.value as PermissionLevel })
                          }
                          className="appearance-none bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white pr-6 focus:outline-none focus:border-purple-500"
                        >
                          {GRANTABLE_LEVELS.map((l) => (
                            <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1 top-1.5 h-3 w-3 text-zinc-400 pointer-events-none" />
                      </div>
                    ) : (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${LEVEL_BADGE[p.permission_level]}`}>
                        {LEVEL_LABELS[p.permission_level]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    {new Date(p.granted_at).toLocaleDateString()}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => revoke.mutate(p.discord_id)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        title="Revoke access"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── By Role ──────────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Tag className="h-4 w-4 text-zinc-400" />
              By Role
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Grant access to everyone who has a specific Discord role.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setShowAddRole((v) => !v); setShowAddUser(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Role
            </button>
          )}
        </div>

        {showAddRole && (
          <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Discord Role *</label>
                <div className="relative">
                  <select
                    value={newRoleId}
                    onChange={(e) => setNewRoleId(e.target.value)}
                    className="w-full appearance-none bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 pr-8"
                  >
                    <option value="">Select a role…</option>
                    {availableRoles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-2.5 h-4 w-4 text-zinc-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Permission Level</label>
                <div className="relative">
                  <select
                    value={newRoleLevel}
                    onChange={(e) => setNewRoleLevel(e.target.value as PermissionLevel)}
                    className="w-full appearance-none bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 pr-8"
                  >
                    {GRANTABLE_LEVELS.map((l) => (
                      <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-2.5 h-4 w-4 text-zinc-400 pointer-events-none" />
                </div>
              </div>
            </div>
            <p className="text-xs text-zinc-500">{LEVEL_DESCRIPTIONS[newRoleLevel]}</p>
            <div className="flex gap-2">
              <button
                onClick={handleGrantRole}
                disabled={!newRoleId || grantRole.isPending}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {grantRole.isPending ? "Granting…" : "Grant Access"}
              </button>
              <button
                onClick={() => setShowAddRole(false)}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {roleLoading ? (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">Loading…</div>
        ) : !rolePermissions || rolePermissions.length === 0 ? (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">
            No role grants yet. Add a role above to grant access to everyone with that role.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left">
                <th className="px-4 py-2 text-xs font-medium text-zinc-400">Role</th>
                <th className="px-4 py-2 text-xs font-medium text-zinc-400">Level</th>
                <th className="px-4 py-2 text-xs font-medium text-zinc-400">Granted</th>
                {isAdmin && <th className="px-4 py-2 text-xs font-medium text-zinc-400 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rolePermissions.map((p) => (
                <tr key={p.role_id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-200">{p.role_name ?? "Unknown Role"}</div>
                    <div className="text-xs text-zinc-500 font-mono">{p.role_id}</div>
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <div className="relative inline-block">
                        <select
                          value={p.permission_level}
                          onChange={(e) =>
                            updateRole.mutate({ roleId: p.role_id, permission_level: e.target.value as PermissionLevel })
                          }
                          className="appearance-none bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white pr-6 focus:outline-none focus:border-purple-500"
                        >
                          {GRANTABLE_LEVELS.map((l) => (
                            <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1 top-1.5 h-3 w-3 text-zinc-400 pointer-events-none" />
                      </div>
                    ) : (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${LEVEL_BADGE[p.permission_level]}`}>
                        {LEVEL_LABELS[p.permission_level]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    {new Date(p.granted_at).toLocaleDateString()}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => revokeRole.mutate(p.role_id)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        title="Revoke role access"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
