import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  FolderKanban,
  KeyRound,
  Lock,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import {
  ACL_PERMISSIONS,
  computeEffectivePermissions,
  evaluateResourceAccess,
  useAclStore,
} from '../store/useAclStore';
import type {
  AclAccessEffect,
  AclModalTab,
  AclResourceKind,
  AclRoleId,
} from '../types/acl';

const GROUP_PALETTE = ['#8B5CF6', '#F59E0B', '#10B981', '#06B6D4', '#EC4899', '#6366F1'];

const ACCESS_BADGE: Record<AclAccessEffect, string> = {
  admin: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/35',
  write: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/35',
  read: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/35',
  deny: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/35',
};

const MODULE_TARGETS = [
  { id: 'mod-spatial-cad', name: 'Module · 2D / 3D CAD Floor Editor' },
  { id: 'mod-ai-planner', name: 'Module · Maya AI & Floor Planner' },
  { id: 'mod-gmp-ops', name: 'Module · GMP Operations & Work Orders' },
  { id: 'mod-telemetry', name: 'Module · Live SCADA Telemetry & Heatmaps' },
  { id: 'mod-cctv-livecam', name: 'Module · LiveCam & Argon2id Credentials' },
  { id: 'mod-rack-42u', name: 'Module · 42U IT / Network Rack Designer' },
  { id: 'mod-acl-security', name: 'Module · ACL, Roles & User Grouping' },
];

export const AclGroupingModal: React.FC = () => {
  const showAclModal = useAclStore((s) => s.showAclModal);
  const aclTab = useAclStore((s) => s.aclTab);
  const roles = useAclStore((s) => s.roles);
  const groups = useAclStore((s) => s.groups);
  const users = useAclStore((s) => s.users);
  const rules = useAclStore((s) => s.rules);

  const closeAclModal = useAclStore((s) => s.closeAclModal);
  const setAclTab = useAclStore((s) => s.setAclTab);
  const addUser = useAclStore((s) => s.addUser);
  const updateUser = useAclStore((s) => s.updateUser);
  const toggleUserGroup = useAclStore((s) => s.toggleUserGroup);
  const deleteUser = useAclStore((s) => s.deleteUser);
  const addGroup = useAclStore((s) => s.addGroup);
  const updateGroup = useAclStore((s) => s.updateGroup);
  const deleteGroup = useAclStore((s) => s.deleteGroup);
  const toggleRolePermission = useAclStore((s) => s.toggleRolePermission);
  const addAclRule = useAclStore((s) => s.addAclRule);
  const toggleAclRule = useAclStore((s) => s.toggleAclRule);
  const updateAclRuleAccess = useAclStore((s) => s.updateAclRuleAccess);
  const deleteAclRule = useAclStore((s) => s.deleteAclRule);

  const scene = useTwinStore((s) => s.scene);
  const theme = useTwinStore((s) => s.theme);
  const showToast = useTwinStore((s) => s.showToast);
  const productionLines = useGmpStore((s) => s.productionLines);

  const isDark = theme === 'dark';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Add User Form
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserDept, setNewUserDept] = useState('Bioprocess Operations');
  const [newUserTitle, setNewUserTitle] = useState('Process Engineer');
  const [newUserRole, setNewUserRole] = useState<AclRoleId>('maintenance-engineer');
  const [newUserGroups, setNewUserGroups] = useState<string[]>(['grp-cal-maint']);

  // Add Group Form
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGrpName, setNewGrpName] = useState('');
  const [newGrpCode, setNewGrpCode] = useState('');
  const [newGrpDesc, setNewGrpDesc] = useState('');
  const [newGrpRole, setNewGrpRole] = useState<AclRoleId>('facility-architect');
  const [newGrpColor, setNewGrpColor] = useState(GROUP_PALETTE[0]);
  const [newGrpScope, setNewGrpScope] = useState<'all-site' | 'building' | 'floor' | 'production-line'>('all-site');

  // Add ACL Rule Form
  const [newRuleResourceKind, setNewRuleResourceKind] = useState<AclResourceKind>('production-line');
  const [newRuleResourceId, setNewRuleResourceId] = useState<string>('');
  const [newRulePrincipalKind, setNewRulePrincipalKind] = useState<'group' | 'user'>('group');
  const [newRulePrincipalId, setNewRulePrincipalId] = useState<string>('');
  const [newRuleAccess, setNewRuleAccess] = useState<AclAccessEffect>('write');
  const [newRuleReason, setNewRuleReason] = useState('');

  // Access Simulator State
  const [simUserId, setSimUserId] = useState<string>('');
  const [simResourceId, setSimResourceId] = useState<string>('line-mab-01');

  const resourceCatalog = useMemo(() => {
    const items: { kind: AclResourceKind; id: string; name: string }[] = [];
    productionLines.forEach((l) =>
      items.push({ kind: 'production-line', id: l.id, name: `${l.code} · ${l.name}` })
    );
    scene.buildings.forEach((b) =>
      items.push({ kind: 'building', id: b.id, name: `Building · ${b.code} ${b.name}` })
    );
    scene.floors.forEach((f) =>
      items.push({ kind: 'floor', id: f.id, name: `Floor · ${f.code} ${f.name}` })
    );
    scene.rooms.slice(0, 24).forEach((r) =>
      items.push({ kind: 'room', id: r.id, name: `Room · ${r.code} ${r.name}` })
    );
    MODULE_TARGETS.forEach((m) => items.push({ kind: 'module', id: m.id, name: m.name }));
    return items;
  }, [productionLines, scene.buildings, scene.floors, scene.rooms]);

  const filteredResourcesForKind = useMemo(
    () => resourceCatalog.filter((r) => r.kind === newRuleResourceKind),
    [resourceCatalog, newRuleResourceKind]
  );

  const activeUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? users[0],
    [users, selectedUserId]
  );

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  const simUser = useMemo(
    () => users.find((u) => u.id === simUserId) ?? users[0],
    [users, simUserId]
  );

  const simResult = useMemo(
    () => evaluateResourceAccess(simUser, simResourceId, rules, roles, groups),
    [simUser, simResourceId, rules, roles, groups]
  );

  if (!showAclModal) return null;

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    addUser({
      displayName: newUserName.trim(),
      email: newUserEmail.trim(),
      department: newUserDept.trim() || 'Operations',
      title: newUserTitle.trim() || 'Specialist',
      roleId: newUserRole,
      groupIds: newUserGroups,
      status: 'active',
      presence: 'offline',
    });
    setNewUserName('');
    setNewUserEmail('');
    setShowAddUser(false);
    showToast(`Added ${newUserName.trim()} to ACL directory`, 'success');
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGrpName.trim()) return;
    const code =
      newGrpCode.trim().toUpperCase() ||
      newGrpName
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 6);
    const scopeLabelMap = {
      'all-site': 'All Site Buildings & Production Lines',
      building: scene.buildings[0] ? `Building · ${scene.buildings[0].name}` : 'Selected Building',
      floor: scene.floors[0] ? `Floor · ${scene.floors[0].name}` : 'Selected Floor',
      'production-line': productionLines[0] ? `Line · ${productionLines[0].name}` : 'Assigned Production Lines',
    };
    addGroup({
      name: newGrpName.trim(),
      code,
      description: newGrpDesc.trim() || 'Custom facility access group.',
      color: newGrpColor,
      defaultRoleId: newGrpRole,
      spatialScope: newGrpScope,
      spatialScopeLabel: scopeLabelMap[newGrpScope],
      spatialTargetIds: [],
    });
    setNewGrpName('');
    setNewGrpCode('');
    setNewGrpDesc('');
    setShowAddGroup(false);
    showToast(`Created user group ${code}`, 'success');
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    const resObj =
      filteredResourcesForKind.find((r) => r.id === newRuleResourceId) ??
      filteredResourcesForKind[0];
    const principalId =
      newRulePrincipalId ||
      (newRulePrincipalKind === 'group' ? groups[0]?.id : users[0]?.id) ||
      '';
    if (!resObj || !principalId) return;
    addAclRule({
      resourceKind: newRuleResourceKind,
      resourceId: resObj.id,
      resourceName: resObj.name,
      principalKind: newRulePrincipalKind,
      principalId,
      access: newRuleAccess,
      enabled: true,
      reason: newRuleReason.trim() || `Explicit ${newRuleAccess.toUpperCase()} policy rule.`,
    });
    setNewRuleReason('');
    showToast(`Added ${newRuleAccess.toUpperCase()} ACL rule on ${resObj.name}`, 'success');
  };

  const tabs: { id: AclModalTab; label: string; count: number; icon: React.ReactNode }[] = [
    { id: 'users', label: 'Users & Presence', count: users.length, icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'groups', label: 'User Groups', count: groups.length, icon: <FolderKanban className="w-3.5 h-3.5" /> },
    { id: 'roles', label: 'Role Matrix', count: roles.length, icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'acls', label: 'Resource ACLs', count: rules.length, icon: <KeyRound className="w-3.5 h-3.5" /> },
  ];

  const onlineCount = users.filter((u) => u.presence === 'online').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4">
      <div
        className={`w-full max-w-6xl h-[90vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden ${
          isDark
            ? 'bg-[#111116] border-zinc-800 text-zinc-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Top Header with explicit Back Button */}
        <header
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b shrink-0 ${
            isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={closeAclModal}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                isDark
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <div className="w-9 h-9 rounded-2xl gradian-violet-amber text-white flex items-center justify-center shadow-md shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold leading-tight truncate">
                  Access Control (ACL), Roles &amp; User Grouping
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {onlineCount} Online
                </span>
              </div>
              <p className={`text-[11px] truncate ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                21 CFR Part 11 RBAC governance · Group-based spatial scopes · Deny-overrides Resource ACLs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setAclTab(t.id)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  aclTab === t.id
                    ? 'bg-violet-600 text-white shadow-md shadow-violet-600/25'
                    : isDark
                      ? 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
                <span
                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md ${
                    aclTab === t.id
                      ? 'bg-white/20 text-white'
                      : isDark
                        ? 'bg-zinc-800 text-zinc-400'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={closeAclModal}
              aria-label="Close ACL Studio"
              className={`p-1.5 rounded-xl transition cursor-pointer ${
                isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-slate-200 text-slate-500'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
          {/* TAB 1: USERS & PRESENCE */}
          {aclTab === 'users' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left Directory List */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter users by name, email, or department..."
                      className={`w-full pl-8 pr-3 py-2 text-xs rounded-xl border ${
                        isDark
                          ? 'bg-[#17171F] border-zinc-800 text-zinc-100'
                          : 'bg-slate-50 border-slate-200 text-slate-900'
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddUser((s) => !s)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Invite User
                  </button>
                </div>

                {showAddUser && (
                  <form
                    onSubmit={handleCreateUser}
                    className={`p-3.5 rounded-2xl border space-y-2.5 ${
                      isDark ? 'bg-[#17171F] border-violet-500/40' : 'bg-violet-50/40 border-violet-200'
                    }`}
                  >
                    <div className="text-xs font-bold text-violet-500">Add Member to Directory</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        required
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        placeholder="Full Name (e.g. Dr. Amir Karimi)"
                        className={`px-3 py-2 text-xs rounded-xl border ${
                          isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                        }`}
                      />
                      <input
                        required
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="Work Email"
                        className={`px-3 py-2 text-xs rounded-xl border ${
                          isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                        }`}
                      />
                      <input
                        value={newUserDept}
                        onChange={(e) => setNewUserDept(e.target.value)}
                        placeholder="Department"
                        className={`px-3 py-2 text-xs rounded-xl border ${
                          isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                        }`}
                      />
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value as AclRoleId)}
                        className={`px-3 py-2 text-xs rounded-xl border ${
                          isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                        }`}
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            Role: {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-zinc-400">Assign Groups:</span>
                      {groups.map((g) => {
                        const checked = newUserGroups.includes(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() =>
                              setNewUserGroups((prev) =>
                                checked ? prev.filter((id) => id !== g.id) : [...prev, g.id]
                              )
                            }
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                              checked
                                ? 'bg-violet-600 text-white border-violet-500'
                                : isDark
                                  ? 'bg-[#111116] border-zinc-700 text-zinc-300'
                                  : 'bg-white border-slate-200 text-slate-600'
                            }`}
                          >
                            {g.code}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddUser(false)}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3.5 py-1.5 rounded-xl bg-amber-500 text-zinc-950 text-xs font-bold cursor-pointer"
                      >
                        Create User
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2">
                  {filteredUsers.map((u) => {
                    const role = roles.find((r) => r.id === u.roleId);
                    const isSel = activeUser?.id === u.id;
                    const initials = u.displayName
                      .split(/\s+/)
                      .map((p) => p[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <div
                        key={u.id}
                        onClick={() => setSelectedUserId(u.id)}
                        className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                          isSel
                            ? isDark
                              ? 'bg-violet-500/12 border-violet-500/60'
                              : 'bg-violet-50 border-violet-400'
                            : isDark
                              ? 'bg-[#17171F] border-zinc-800 hover:border-zinc-700'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative shrink-0">
                            {u.photoURL ? (
                              <img
                                src={u.photoURL}
                                alt={u.displayName}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded-full object-cover ring-2 ring-violet-500/30"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full gradian-violet-amber text-white text-xs font-bold flex items-center justify-center">
                                {initials}
                              </div>
                            )}
                            <span
                              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ${
                                isDark ? 'ring-[#17171F]' : 'ring-white'
                              } ${
                                u.presence === 'online'
                                  ? 'bg-emerald-500'
                                  : u.presence === 'away'
                                    ? 'bg-amber-400'
                                    : 'bg-zinc-500'
                              }`}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold truncate">{u.displayName}</span>
                              {u.isCurrentUser && (
                                <span className="px-1.5 py-0.5 rounded-md text-[9.5px] font-bold bg-amber-500/20 text-amber-500">
                                  YOU
                                </span>
                              )}
                              {u.status === 'suspended' && (
                                <span className="px-1.5 py-0.5 rounded-md text-[9.5px] font-bold bg-rose-500/20 text-rose-500">
                                  SUSPENDED
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400 truncate">
                              {u.email} · {u.department}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {role && (
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${role.badgeClass}`}>
                                  {role.name}
                                </span>
                              )}
                              {u.groupIds.map((gid) => {
                                const g = groups.find((x) => x.id === gid);
                                if (!g) return null;
                                return (
                                  <span
                                    key={gid}
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono ${
                                      isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.color }} />
                                    {g.code}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div
                            className={`text-[10.5px] font-semibold capitalize ${
                              u.presence === 'online'
                                ? 'text-emerald-500'
                                : u.presence === 'away'
                                  ? 'text-amber-500'
                                  : 'text-zinc-400'
                            }`}
                          >
                            {u.presence}
                          </div>
                          <div className="text-[10px] text-zinc-400">{u.lastActiveAt}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Selected User Inspector: Role, Group Assignments & Effective Permissions */}
              <div className="lg:col-span-5">
                {activeUser && (() => {
                  const effPerms = computeEffectivePermissions(activeUser, roles, groups);
                  return (
                    <div
                      className={`p-4 rounded-2xl border space-y-4 ${
                        isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-bold">{activeUser.displayName}</div>
                          <div className="text-[11px] text-zinc-400">
                            {activeUser.title} · {activeUser.email}
                          </div>
                        </div>
                        {!activeUser.isCurrentUser && (
                          <button
                            type="button"
                            onClick={() => deleteUser(activeUser.id)}
                            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                            title="Remove User"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="space-y-1">
                          <span className="text-[10.5px] font-semibold text-zinc-400">Primary Role</span>
                          <select
                            value={activeUser.roleId}
                            onChange={(e) =>
                              updateUser(activeUser.id, { roleId: e.target.value as AclRoleId })
                            }
                            className={`w-full px-2.5 py-2 text-xs rounded-xl border ${
                              isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                            }`}
                          >
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10.5px] font-semibold text-zinc-400">Account Status</span>
                          <select
                            value={activeUser.status}
                            disabled={activeUser.isCurrentUser}
                            onChange={(e) =>
                              updateUser(activeUser.id, {
                                status: e.target.value as 'active' | 'suspended',
                              })
                            }
                            className={`w-full px-2.5 py-2 text-xs rounded-xl border ${
                              isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                            }`}
                          >
                            <option value="active">Active</option>
                            <option value="suspended">Suspended (Revoke Access)</option>
                          </select>
                        </label>
                      </div>

                      {/* Group Membership Toggles */}
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold text-zinc-400">
                          Group Memberships (Click to Assign / Remove)
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {groups.map((g) => {
                            const member = activeUser.groupIds.includes(g.id);
                            return (
                              <button
                                key={g.id}
                                type="button"
                                onClick={() => toggleUserGroup(activeUser.id, g.id)}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition cursor-pointer ${
                                  member
                                    ? 'bg-violet-600 text-white border-violet-500 shadow-xs'
                                    : isDark
                                      ? 'bg-[#111116] border-zinc-700 text-zinc-300 hover:border-violet-500/60'
                                      : 'bg-white border-slate-200 text-slate-700 hover:border-violet-400'
                                }`}
                              >
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: member ? '#FFFFFF' : g.color }}
                                />
                                <span>{g.name}</span>
                                {member && <Check className="w-3 h-3" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Effective Permissions Computed Union */}
                      <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-zinc-400">
                            Effective Permissions (Role ∪ Groups)
                          </span>
                          <span className="font-mono text-[10.5px] text-emerald-500 font-semibold">
                            {effPerms.length} / {ACL_PERMISSIONS.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {ACL_PERMISSIONS.map((perm) => {
                            const granted = effPerms.includes(perm.key);
                            return (
                              <div
                                key={perm.key}
                                className={`px-2.5 py-1.5 rounded-xl border text-[11px] flex items-center gap-1.5 ${
                                  granted
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
                                    : isDark
                                      ? 'bg-[#111116] border-zinc-800 text-zinc-500'
                                      : 'bg-white border-slate-200 text-slate-400'
                                }`}
                              >
                                {granted ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                                ) : (
                                  <Lock className="w-3 h-3 shrink-0 opacity-60" />
                                )}
                                <span className="truncate">{perm.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* TAB 2: USER GROUPS */}
          {aclTab === 'groups' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold">Organizational User Groups &amp; Spatial Scopes</h3>
                  <p className="text-xs text-zinc-400">
                    Group members inherit the group&apos;s default role permissions and spatial resource ACLs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddGroup((s) => !s)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Group
                </button>
              </div>

              {showAddGroup && (
                <form
                  onSubmit={handleCreateGroup}
                  className={`p-4 rounded-2xl border space-y-3 ${
                    isDark ? 'bg-[#17171F] border-amber-500/40' : 'bg-amber-50/40 border-amber-200'
                  }`}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      required
                      value={newGrpName}
                      onChange={(e) => setNewGrpName(e.target.value)}
                      placeholder="Group Name (e.g. Cleanroom Shift A)"
                      className={`px-3 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    />
                    <input
                      value={newGrpCode}
                      onChange={(e) => setNewGrpCode(e.target.value)}
                      placeholder="Short Code (e.g. SHIFT-A)"
                      className={`px-3 py-2 text-xs rounded-xl border font-mono ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    />
                    <select
                      value={newGrpRole}
                      onChange={(e) => setNewGrpRole(e.target.value as AclRoleId)}
                      className={`px-3 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          Inherited Role: {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      value={newGrpDesc}
                      onChange={(e) => setNewGrpDesc(e.target.value)}
                      placeholder="Description & GMP responsibility..."
                      className={`px-3 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    />
                    <select
                      value={newGrpScope}
                      onChange={(e) => setNewGrpScope(e.target.value as any)}
                      className={`px-3 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    >
                      <option value="all-site">Spatial Scope: All Site</option>
                      <option value="building">Spatial Scope: Building Level</option>
                      <option value="floor">Spatial Scope: Floor Level</option>
                      <option value="production-line">Spatial Scope: Production Line</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-zinc-400">Badge Color:</span>
                      {GROUP_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewGrpColor(c)}
                          className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${
                            newGrpColor === c ? 'scale-110 ring-2 ring-white' : 'opacity-70'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddGroup(false)}
                        className="px-3 py-1.5 text-xs text-zinc-400 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-semibold cursor-pointer"
                      >
                        Create Group
                      </button>
                    </div>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {groups.map((grp) => {
                  const members = users.filter((u) => u.groupIds.includes(grp.id));
                  const groupRuleCount = rules.filter(
                    (r) => r.principalKind === 'group' && r.principalId === grp.id
                  ).length;
                  return (
                    <div
                      key={grp.id}
                      className={`p-4 rounded-2xl border space-y-3 ${
                        isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-mono text-[11px] font-bold shrink-0"
                            style={{ backgroundColor: grp.color }}
                          >
                            {grp.code.slice(0, 4)}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{grp.name}</div>
                            <div className="text-[11px] text-zinc-400 truncate">
                              {grp.spatialScopeLabel}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteGroup(grp.id)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                          title="Delete Group"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-[11.5px] text-zinc-400 leading-relaxed">{grp.description}</p>

                      <div className="flex items-center justify-between gap-2 text-xs">
                        <label className="flex items-center gap-1.5">
                          <span className="text-[10.5px] text-zinc-400">Default Role:</span>
                          <select
                            value={grp.defaultRoleId}
                            onChange={(e) =>
                              updateGroup(grp.id, { defaultRoleId: e.target.value as AclRoleId })
                            }
                            className={`px-2 py-1 text-[11px] rounded-lg border ${
                              isDark ? 'bg-[#111116] border-zinc-700' : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="font-mono text-[10.5px] text-violet-400">
                          {groupRuleCount} ACL rule{groupRuleCount === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5">
                        <div className="text-[10.5px] font-semibold text-zinc-400">
                          Members ({members.length}) — click to toggle
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {users.map((u) => {
                            const inGrp = u.groupIds.includes(grp.id);
                            return (
                              <button
                                key={u.id}
                                type="button"
                                onClick={() => toggleUserGroup(u.id, grp.id)}
                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border transition cursor-pointer ${
                                  inGrp
                                    ? 'bg-violet-500/15 border-violet-500/50 text-violet-600 dark:text-violet-300 font-semibold'
                                    : isDark
                                      ? 'bg-[#111116] border-zinc-800 text-zinc-400 hover:border-zinc-600'
                                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    u.presence === 'online' ? 'bg-emerald-500' : 'bg-zinc-500'
                                  }`}
                                />
                                <span>{u.displayName.split(' ')[0]}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: ROLE PERMISSION MATRIX */}
          {aclTab === 'roles' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-bold">Interactive RBAC Role Permission Matrix</h3>
                <p className="text-xs text-zinc-400">
                  Toggle individual permissions per role. Changes immediately recalculate effective access for all users and groups.
                </p>
              </div>
              <div
                className={`overflow-x-auto rounded-2xl border ${
                  isDark ? 'border-zinc-800 bg-[#17171F]' : 'border-slate-200 bg-white'
                }`}
              >
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className={`border-b ${isDark ? 'border-zinc-800 bg-[#13131A]' : 'border-slate-200 bg-slate-50'}`}>
                      <th className="p-3 font-semibold min-w-[230px]">Permission Capability</th>
                      {roles.map((r) => (
                        <th key={r.id} className="p-3 text-center font-semibold min-w-[110px]">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] border ${r.badgeClass}`}>
                              {r.name.split(' ')[0]}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              {r.permissions.length}/{ACL_PERMISSIONS.length}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/80">
                    {ACL_PERMISSIONS.map((perm) => (
                      <tr key={perm.key} className="hover:bg-violet-500/5">
                        <td className="p-3">
                          <div className="font-semibold">{perm.label}</div>
                          <div className="text-[10.5px] text-zinc-400">
                            {perm.domain} · <span className="font-mono">{perm.key}</span>
                          </div>
                        </td>
                        {roles.map((r) => {
                          const has = r.permissions.includes(perm.key);
                          const locked = r.id === 'system-admin' && perm.key === 'acl.manage';
                          return (
                            <td key={r.id} className="p-3 text-center">
                              <button
                                type="button"
                                disabled={locked}
                                onClick={() => toggleRolePermission(r.id, perm.key)}
                                className={`w-7 h-7 rounded-lg inline-flex items-center justify-center border transition cursor-pointer disabled:opacity-60 ${
                                  has
                                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-500'
                                    : isDark
                                      ? 'bg-[#111116] border-zinc-800 text-zinc-600 hover:border-zinc-600'
                                      : 'bg-slate-50 border-slate-200 text-slate-300 hover:border-slate-400'
                                }`}
                                title={locked ? 'System Admin always retains ACL governance' : `Toggle ${perm.label} for ${r.name}`}
                              >
                                {has ? <Check className="w-3.5 h-3.5" /> : <X className="w-3 h-3" />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: RESOURCE-LEVEL ACL RULES & ACCESS SIMULATOR */}
          {aclTab === 'acls' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left: Create Rule + Active ACL Rules List */}
              <div className="lg:col-span-8 space-y-4">
                <form
                  onSubmit={handleCreateRule}
                  className={`p-4 rounded-2xl border space-y-3 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="text-xs font-bold flex items-center gap-1.5 text-violet-500">
                    <KeyRound className="w-3.5 h-3.5" />
                    Add Spatial / Module ACL Rule (Explicit Deny Overrides Allow)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <select
                      value={newRuleResourceKind}
                      onChange={(e) => {
                        setNewRuleResourceKind(e.target.value as AclResourceKind);
                        setNewRuleResourceId('');
                      }}
                      className={`px-2.5 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    >
                      <option value="production-line">Production Line</option>
                      <option value="building">Building</option>
                      <option value="floor">Floor</option>
                      <option value="room">Room / Cleanroom</option>
                      <option value="module">Workspace Module</option>
                    </select>

                    <select
                      value={newRuleResourceId || filteredResourcesForKind[0]?.id || ''}
                      onChange={(e) => setNewRuleResourceId(e.target.value)}
                      className={`px-2.5 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    >
                      {filteredResourcesForKind.map((res) => (
                        <option key={res.id} value={res.id}>
                          {res.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={`${newRulePrincipalKind}:${newRulePrincipalId || (newRulePrincipalKind === 'group' ? groups[0]?.id : users[0]?.id) || ''}`}
                      onChange={(e) => {
                        const [kind, pid] = e.target.value.split(':');
                        setNewRulePrincipalKind(kind as 'group' | 'user');
                        setNewRulePrincipalId(pid);
                      }}
                      className={`px-2.5 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    >
                      <optgroup label="User Groups">
                        {groups.map((g) => (
                          <option key={g.id} value={`group:${g.id}`}>
                            Group: {g.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Individual Users">
                        {users.map((u) => (
                          <option key={u.id} value={`user:${u.id}`}>
                            User: {u.displayName}
                          </option>
                        ))}
                      </optgroup>
                    </select>

                    <select
                      value={newRuleAccess}
                      onChange={(e) => setNewRuleAccess(e.target.value as AclAccessEffect)}
                      className={`px-2.5 py-2 text-xs rounded-xl border font-semibold ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    >
                      <option value="admin">ADMIN (Full Control)</option>
                      <option value="write">WRITE (Edit &amp; Execute)</option>
                      <option value="read">READ (View Only)</option>
                      <option value="deny">DENY (Block Access)</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={newRuleReason}
                      onChange={(e) => setNewRuleReason(e.target.value)}
                      placeholder="Audit justification / GMP SOP reference..."
                      className={`flex-1 min-w-[200px] px-3 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add ACL Entry
                    </button>
                  </div>
                </form>

                <div className="space-y-2">
                  {rules.map((rule) => {
                    const principalLabel =
                      rule.principalKind === 'group'
                        ? groups.find((g) => g.id === rule.principalId)?.name ?? rule.principalId
                        : users.find((u) => u.id === rule.principalId)?.displayName ?? rule.principalId;
                    return (
                      <div
                        key={rule.id}
                        className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
                          !rule.enabled ? 'opacity-50' : ''
                        } ${isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-white border-slate-200'}`}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${ACCESS_BADGE[rule.access]}`}
                            >
                              {rule.access}
                            </span>
                            <span className="text-xs font-bold truncate">{rule.resourceName}</span>
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            Principal:{' '}
                            <strong className={isDark ? 'text-zinc-200' : 'text-slate-700'}>
                              {rule.principalKind === 'group' ? 'Group' : 'User'} · {principalLabel}
                            </strong>{' '}
                            · {rule.reason}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            value={rule.access}
                            onChange={(e) =>
                              updateAclRuleAccess(rule.id, e.target.value as AclAccessEffect)
                            }
                            className={`px-2 py-1 text-[11px] rounded-lg border ${
                              isDark ? 'bg-[#111116] border-zinc-700' : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <option value="admin">Admin</option>
                            <option value="write">Write</option>
                            <option value="read">Read</option>
                            <option value="deny">Deny</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => toggleAclRule(rule.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                              rule.enabled
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-500'
                                : 'bg-zinc-500/15 border-zinc-500/35 text-zinc-400'
                            }`}
                          >
                            {rule.enabled ? 'Active' : 'Paused'}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteAclRule(rule.id)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                            title="Delete ACL Rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: Live ACL Access Simulator */}
              <div className="lg:col-span-4">
                <div
                  className={`p-4 rounded-2xl border space-y-3.5 sticky top-0 ${
                    isDark ? 'bg-[#17171F] border-zinc-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-500" />
                    <h4 className="text-xs font-bold uppercase tracking-wider">
                      Effective Access Simulator
                    </h4>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Test real-time ACL resolution (Explicit Deny → Resource Allow → Group/Role RBAC).
                  </p>

                  <label className="block space-y-1">
                    <span className="text-[10.5px] font-semibold text-zinc-400">Select User</span>
                    <select
                      value={simUser?.id ?? ''}
                      onChange={(e) => setSimUserId(e.target.value)}
                      className={`w-full px-2.5 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName} ({u.presence})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[10.5px] font-semibold text-zinc-400">Target Resource</span>
                    <select
                      value={simResourceId}
                      onChange={(e) => setSimResourceId(e.target.value)}
                      className={`w-full px-2.5 py-2 text-xs rounded-xl border ${
                        isDark ? 'bg-[#111116] border-zinc-700' : 'bg-white border-slate-200'
                      }`}
                    >
                      {resourceCatalog.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div
                    className={`p-3.5 rounded-2xl border space-y-2 ${
                      simResult.decision === 'ALLOW'
                        ? 'bg-emerald-500/12 border-emerald-500/40'
                        : 'bg-rose-500/12 border-rose-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-extrabold flex items-center gap-1.5 ${
                          simResult.decision === 'ALLOW' ? 'text-emerald-500' : 'text-rose-500'
                        }`}
                      >
                        {simResult.decision === 'ALLOW' ? (
                          <ShieldCheck className="w-4 h-4" />
                        ) : (
                          <ShieldAlert className="w-4 h-4" />
                        )}
                        {simResult.decision}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase border ${ACCESS_BADGE[simResult.level]}`}
                      >
                        {simResult.level}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                      {simResult.reason}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
