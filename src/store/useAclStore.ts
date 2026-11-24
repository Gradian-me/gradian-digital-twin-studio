import { create } from 'zustand';
import type {
  AclAccessEffect,
  AclGroup,
  AclModalTab,
  AclPermissionKey,
  AclPermissionMeta,
  AclResourceRule,
  AclRoleDefinition,
  AclRoleId,
  AclUserMember,
} from '../types/acl';

const ACL_STORAGE_KEY = 'gradian_acl_groups_v1';

export const ACL_PERMISSIONS: AclPermissionMeta[] = [
  {
    key: 'spatial.view',
    label: 'View 2D / 3D Maps',
    domain: 'Spatial & CAD',
    description: 'Browse buildings, floors, cleanrooms, and 3D digital twin viewports.',
  },
  {
    key: 'spatial.edit',
    label: 'Edit Layout & Equipment',
    domain: 'Spatial & CAD',
    description: 'Draw rooms/walls, move assets, modify process flows, and run AI Planner.',
  },
  {
    key: 'spatial.delete',
    label: 'Delete Spatial Objects',
    domain: 'Spatial & CAD',
    description: 'Remove rooms, walls, floors, cameras, or equipment from the twin.',
  },
  {
    key: 'spatial.export',
    label: 'Export GLB / JSON / Prints',
    domain: 'Spatial & CAD',
    description: 'Export 3D models, snapshots, industrial QR labels, and compliance packets.',
  },
  {
    key: 'gmp.eligibility_check',
    label: 'Run Line Eligibility Checks',
    domain: 'GMP & Compliance',
    description: 'Evaluate Production Line readiness and highlight pass/fail zones.',
  },
  {
    key: 'gmp.edit_compliance',
    label: 'Edit Cal / Qual / PM Dates',
    domain: 'GMP & Compliance',
    description: 'Modify calibration, IQ/OQ/PQ qualification, and preventive maintenance dates.',
  },
  {
    key: 'gmp.manage_workorders',
    label: 'Create & Close Work Orders',
    domain: 'GMP & Compliance',
    description: 'Manage work order inbox, cron jobs, and certified technician assignments.',
  },
  {
    key: 'gmp.approve_sops',
    label: 'Approve SOPs & Wiki Docs',
    domain: 'GMP & Compliance',
    description: 'Publish controlled SOP procedures, records, and troubleshooting guides.',
  },
  {
    key: 'telemetry.view',
    label: 'View Live Telemetry & Trends',
    domain: 'Telemetry & Security',
    description: 'Inspect real-time bioreactor, HPLC, HVAC heatmaps, and sensor trends.',
  },
  {
    key: 'telemetry.manage_sensors',
    label: 'Define Sensor Tags & Thresholds',
    domain: 'Telemetry & Security',
    description: 'Bind PLC/OPC-UA tags and edit warning/alarm limits.',
  },
  {
    key: 'cameras.view_live',
    label: 'Access LiveCam & CCTV Feeds',
    domain: 'Telemetry & Security',
    description: 'Preview IP/RTSP cleanroom cameras and manage Argon2id camera credentials.',
  },
  {
    key: 'acl.manage',
    label: 'Manage Users, Groups & ACLs',
    domain: 'Telemetry & Security',
    description: 'Configure roles, organizational groups, and spatial resource ACL rules.',
  },
];

export const INITIAL_ROLES: AclRoleDefinition[] = [
  {
    id: 'system-admin',
    name: 'System Admin',
    description: 'Unrestricted governance over spatial twins, GMP compliance, SCADA, and ACL security.',
    color: '#8B5CF6',
    badgeClass: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30',
    permissions: ACL_PERMISSIONS.map((p) => p.key),
    systemProtected: true,
  },
  {
    id: 'facility-architect',
    name: 'Facility Architect',
    description: 'Full 2D/3D CAD design, AI Floor Planner, flow optimization, and model library access.',
    color: '#F59E0B',
    badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
    permissions: [
      'spatial.view',
      'spatial.edit',
      'spatial.delete',
      'spatial.export',
      'gmp.eligibility_check',
      'telemetry.view',
      'cameras.view_live',
    ],
  },
  {
    id: 'qa-compliance',
    name: 'QA / GMP Compliance Lead',
    description: 'Owns Production Line eligibility, IQ/OQ/PQ dates, SOP releases, and 21 CFR Part 11 audits.',
    color: '#10B981',
    badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
    permissions: [
      'spatial.view',
      'spatial.export',
      'gmp.eligibility_check',
      'gmp.edit_compliance',
      'gmp.manage_workorders',
      'gmp.approve_sops',
      'telemetry.view',
    ],
  },
  {
    id: 'maintenance-engineer',
    name: 'Maintenance & Calibration Eng.',
    description: 'Executes work orders, cron schedules, calibration renewals, and industrial QR labeling.',
    color: '#06B6D4',
    badgeClass: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30',
    permissions: [
      'spatial.view',
      'spatial.export',
      'gmp.eligibility_check',
      'gmp.edit_compliance',
      'gmp.manage_workorders',
      'telemetry.view',
      'telemetry.manage_sensors',
    ],
  },
  {
    id: 'scada-operator',
    name: 'SCADA & Process Operator',
    description: 'Monitors live cleanroom telemetry, bioreactor trends, alarms, and camera feeds.',
    color: '#EC4899',
    badgeClass: 'bg-pink-500/15 text-pink-600 dark:text-pink-300 border-pink-500/30',
    permissions: [
      'spatial.view',
      'gmp.eligibility_check',
      'telemetry.view',
      'telemetry.manage_sensors',
      'cameras.view_live',
    ],
  },
  {
    id: 'auditor-readonly',
    name: 'Regulatory Auditor (Read-Only)',
    description: 'Non-destructive inspection of layouts, audit trails, compliance timelines, and SOPs.',
    color: '#71717A',
    badgeClass: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30',
    permissions: ['spatial.view', 'gmp.eligibility_check', 'telemetry.view'],
  },
];

export const INITIAL_GROUPS: AclGroup[] = [
  {
    id: 'grp-qa-gmp',
    name: 'GMP Quality Assurance',
    code: 'QA-GMP',
    description: 'Quality directors, validation leads, and batch release approvers.',
    color: '#10B981',
    defaultRoleId: 'qa-compliance',
    spatialScope: 'all-site',
    spatialScopeLabel: 'All Site Buildings & Production Lines',
    spatialTargetIds: [],
    createdAt: '2026-01-14',
  },
  {
    id: 'grp-bioprocess',
    name: 'Bioprocess & Facility Design',
    code: 'BIO-ENG',
    description: 'Upstream/downstream architects designing Grade A-D suites and equipment layouts.',
    color: '#8B5CF6',
    defaultRoleId: 'facility-architect',
    spatialScope: 'building',
    spatialScopeLabel: 'Building A · Biomanufacturing Core',
    spatialTargetIds: ['bldg-a'],
    createdAt: '2026-01-18',
  },
  {
    id: 'grp-cal-maint',
    name: 'Metrology, Calibration & PM',
    code: 'METRO-PM',
    description: 'Certified technicians handling bioreactors, lyophilizers, autoclaves, and HPLC PMs.',
    color: '#F59E0B',
    defaultRoleId: 'maintenance-engineer',
    spatialScope: 'all-site',
    spatialScopeLabel: 'All Equipment & Utility Skids',
    spatialTargetIds: [],
    createdAt: '2026-02-02',
  },
  {
    id: 'grp-it-scada',
    name: 'OT / SCADA & Data Center Security',
    code: 'OT-SEC',
    description: '42U server rack engineers, PLC/OPC-UA telemetry owners, and CCTV operators.',
    color: '#06B6D4',
    defaultRoleId: 'scada-operator',
    spatialScope: 'floor',
    spatialScopeLabel: 'SCADA Telemetry & Server Rooms',
    spatialTargetIds: [],
    createdAt: '2026-02-11',
  },
  {
    id: 'grp-fda-auditors',
    name: 'External Regulatory Auditors',
    code: 'EXT-AUD',
    description: 'Time-boxed read-only access for FDA / EMA GMP facility inspections.',
    color: '#71717A',
    defaultRoleId: 'auditor-readonly',
    spatialScope: 'all-site',
    spatialScopeLabel: 'Read-Only Inspection Scope',
    spatialTargetIds: [],
    createdAt: '2026-03-01',
  },
];

export const INITIAL_USERS: AclUserMember[] = [
  {
    id: 'usr-elena',
    displayName: 'Dr. Elena Rostova',
    email: 'elena.rostova@cinnagen-twin.io',
    department: 'Quality Assurance',
    title: 'VP of GMP Quality & Validation',
    roleId: 'qa-compliance',
    groupIds: ['grp-qa-gmp'],
    status: 'active',
    presence: 'online',
    lastActiveAt: 'Just now',
  },
  {
    id: 'usr-marcus',
    displayName: 'Marcus Vance',
    email: 'marcus.vance@cinnagen-twin.io',
    department: 'Bioprocess Engineering',
    title: 'Principal Facility Architect',
    roleId: 'facility-architect',
    groupIds: ['grp-bioprocess'],
    status: 'active',
    presence: 'online',
    lastActiveAt: '2m ago',
  },
  {
    id: 'usr-sara',
    displayName: 'Sara Lindqvist',
    email: 'sara.lindqvist@cinnagen-twin.io',
    department: 'Metrology & Calibration',
    title: 'Lead Instrumentation Engineer',
    roleId: 'maintenance-engineer',
    groupIds: ['grp-cal-maint', 'grp-it-scada'],
    status: 'active',
    presence: 'away',
    lastActiveAt: '14m ago',
  },
  {
    id: 'usr-david',
    displayName: 'David Okafor',
    email: 'david.okafor@cinnagen-twin.io',
    department: 'OT / SCADA Automation',
    title: 'Senior SCADA & Network Security Lead',
    roleId: 'scada-operator',
    groupIds: ['grp-it-scada'],
    status: 'active',
    presence: 'online',
    lastActiveAt: '4m ago',
  },
  {
    id: 'usr-claire',
    displayName: 'Claire Moreau',
    email: 'claire.moreau@ema-inspect.eu',
    department: 'External Regulatory Inspection',
    title: 'Lead GMP Inspector',
    roleId: 'auditor-readonly',
    groupIds: ['grp-fda-auditors'],
    status: 'active',
    presence: 'offline',
    lastActiveAt: 'Yesterday',
  },
];

export const INITIAL_ACL_RULES: AclResourceRule[] = [
  {
    id: 'acl-1',
    resourceKind: 'production-line',
    resourceId: 'line-mab-01',
    resourceName: 'LINE-01 · mAb Drug Substance Suite',
    principalKind: 'group',
    principalId: 'grp-qa-gmp',
    access: 'admin',
    enabled: true,
    reason: 'QA holds final batch release & line eligibility override authority.',
    updatedAt: '2026-10-12',
  },
  {
    id: 'acl-2',
    resourceKind: 'module',
    resourceId: 'mod-cctv-livecam',
    resourceName: 'Module · LiveCam & Argon2id Credentials',
    principalKind: 'group',
    principalId: 'grp-fda-auditors',
    access: 'deny',
    enabled: true,
    reason: 'External auditors are restricted from live CCTV camera credential panels.',
    updatedAt: '2026-10-19',
  },
  {
    id: 'acl-3',
    resourceKind: 'module',
    resourceId: 'mod-rack-42u',
    resourceName: 'Module · 42U IT / Network Rack Designer',
    principalKind: 'group',
    principalId: 'grp-it-scada',
    access: 'write',
    enabled: true,
    reason: 'OT/SCADA team owns switch ports, VLAN assignments, and patch panels.',
    updatedAt: '2026-11-01',
  },
  {
    id: 'acl-4',
    resourceKind: 'production-line',
    resourceId: 'line-fill-02',
    resourceName: 'LINE-02 · Aseptic Fill-Finish & Lyo',
    principalKind: 'group',
    principalId: 'grp-cal-maint',
    access: 'write',
    enabled: true,
    reason: 'Metrology team authorized to complete overdue LYO-401 & FILL-402 work orders.',
    updatedAt: '2026-11-10',
  },
];

interface PersistedAclState {
  roles: AclRoleDefinition[];
  groups: AclGroup[];
  users: AclUserMember[];
  rules: AclResourceRule[];
}

function loadPersistedAcl(): Partial<PersistedAclState> | null {
  try {
    const raw = localStorage.getItem(ACL_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersistedAcl(state: PersistedAclState) {
  try {
    localStorage.setItem(ACL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

export function computeEffectivePermissions(
  user: AclUserMember | undefined,
  roles: AclRoleDefinition[],
  groups: AclGroup[]
): AclPermissionKey[] {
  if (!user || user.status === 'suspended') return [];
  const perms = new Set<AclPermissionKey>();
  const directRole = roles.find((r) => r.id === user.roleId);
  directRole?.permissions.forEach((p) => perms.add(p));
  for (const gid of user.groupIds) {
    const grp = groups.find((g) => g.id === gid);
    if (!grp) continue;
    const grpRole = roles.find((r) => r.id === grp.defaultRoleId);
    grpRole?.permissions.forEach((p) => perms.add(p));
  }
  return Array.from(perms);
}

export function evaluateResourceAccess(
  user: AclUserMember | undefined,
  resourceId: string,
  rules: AclResourceRule[],
  roles: AclRoleDefinition[],
  groups: AclGroup[]
): { decision: 'ALLOW' | 'DENY'; level: AclAccessEffect; matchedRule: AclResourceRule | null; reason: string } {
  if (!user) {
    return { decision: 'DENY', level: 'deny', matchedRule: null, reason: 'No active user selected.' };
  }
  if (user.status === 'suspended') {
    return { decision: 'DENY', level: 'deny', matchedRule: null, reason: 'User account is suspended.' };
  }

  const matching = rules.filter(
    (r) =>
      r.enabled &&
      r.resourceId === resourceId &&
      ((r.principalKind === 'user' && r.principalId === user.id) ||
        (r.principalKind === 'group' && user.groupIds.includes(r.principalId)))
  );

  // Explicit Deny always takes highest precedence
  const denyRule = matching.find((r) => r.access === 'deny');
  if (denyRule) {
    return {
      decision: 'DENY',
      level: 'deny',
      matchedRule: denyRule,
      reason: `Explicit DENY rule (${denyRule.principalKind === 'group' ? 'Group' : 'User'}): ${denyRule.reason}`,
    };
  }

  const rank: Record<AclAccessEffect, number> = { deny: 0, read: 1, write: 2, admin: 3 };
  if (matching.length > 0) {
    const highest = [...matching].sort((a, b) => rank[b.access] - rank[a.access])[0];
    return {
      decision: 'ALLOW',
      level: highest.access,
      matchedRule: highest,
      reason: `Granted ${highest.access.toUpperCase()} via ACL rule: ${highest.reason}`,
    };
  }

  // Fallback to Role / Group RBAC permissions
  const effPerms = computeEffectivePermissions(user, roles, groups);
  if (effPerms.includes('acl.manage')) {
    return {
      decision: 'ALLOW',
      level: 'admin',
      matchedRule: null,
      reason: 'Inherited ADMIN access via System Admin / ACL Manage role permission.',
    };
  }
  if (effPerms.includes('spatial.edit') || effPerms.includes('gmp.manage_workorders')) {
    return {
      decision: 'ALLOW',
      level: 'write',
      matchedRule: null,
      reason: 'Inherited WRITE access from assigned role & group memberships.',
    };
  }
  return {
    decision: 'ALLOW',
    level: 'read',
    matchedRule: null,
    reason: 'Default READ-ONLY access from role baseline.',
  };
}

interface AclState {
  roles: AclRoleDefinition[];
  groups: AclGroup[];
  users: AclUserMember[];
  rules: AclResourceRule[];

  showAclModal: boolean;
  aclTab: AclModalTab;

  syncAuthUser: (
    authUser: { uid: string; displayName: string | null; email: string | null; photoURL: string | null } | null,
    isOnline: boolean
  ) => void;
  setCurrentUserOnline: (isOnline: boolean) => void;

  // Users
  addUser: (user: Omit<AclUserMember, 'id' | 'lastActiveAt'>) => void;
  updateUser: (userId: string, patch: Partial<AclUserMember>) => void;
  toggleUserGroup: (userId: string, groupId: string) => void;
  deleteUser: (userId: string) => void;

  // Groups
  addGroup: (group: Omit<AclGroup, 'id' | 'createdAt'>) => void;
  updateGroup: (groupId: string, patch: Partial<AclGroup>) => void;
  deleteGroup: (groupId: string) => void;

  // Role Permission Matrix
  toggleRolePermission: (roleId: AclRoleId, permission: AclPermissionKey) => void;

  // Resource ACL Rules
  addAclRule: (rule: Omit<AclResourceRule, 'id' | 'updatedAt'>) => void;
  toggleAclRule: (ruleId: string) => void;
  updateAclRuleAccess: (ruleId: string, access: AclAccessEffect) => void;
  deleteAclRule: (ruleId: string) => void;

  // Modal controls
  openAclModal: (tab?: AclModalTab) => void;
  closeAclModal: () => void;
  setAclTab: (tab: AclModalTab) => void;
}

const persisted = loadPersistedAcl();

export const useAclStore = create<AclState>((set, get) => {
  const commit = (next: Partial<PersistedAclState>) => {
    const cur = get();
    const merged: PersistedAclState = {
      roles: next.roles ?? cur.roles,
      groups: next.groups ?? cur.groups,
      users: next.users ?? cur.users,
      rules: next.rules ?? cur.rules,
    };
    savePersistedAcl(merged);
    set(merged);
  };

  return {
    roles: persisted?.roles?.length ? persisted.roles : INITIAL_ROLES,
    groups: persisted?.groups?.length ? persisted.groups : INITIAL_GROUPS,
    users: persisted?.users?.length ? persisted.users : INITIAL_USERS,
    rules: persisted?.rules?.length ? persisted.rules : INITIAL_ACL_RULES,

    showAclModal: false,
    aclTab: 'users',

    syncAuthUser: (authUser, isOnline) => {
      const cur = get();
      if (!authUser) {
        const cleaned = cur.users.map((u) => (u.isCurrentUser ? { ...u, isCurrentUser: false, presence: 'offline' as const } : u));
        commit({ users: cleaned });
        return;
      }
      const existing = cur.users.find((u) => u.uid === authUser.uid || u.email.toLowerCase() === (authUser.email || '').toLowerCase());
      const nowLabel = isOnline ? 'Online now' : 'Offline';
      if (existing) {
        const nextUsers = cur.users.map((u) =>
          u.id === existing.id
            ? {
                ...u,
                uid: authUser.uid,
                displayName: authUser.displayName || u.displayName || authUser.email?.split('@')[0] || 'Workspace User',
                email: authUser.email || u.email,
                photoURL: authUser.photoURL ?? u.photoURL,
                isCurrentUser: true,
                presence: isOnline ? ('online' as const) : ('offline' as const),
                lastActiveAt: nowLabel,
              }
            : { ...u, isCurrentUser: false }
        );
        commit({ users: nextUsers });
      } else {
        const newMember: AclUserMember = {
          id: `usr-auth-${authUser.uid.slice(0, 8)}`,
          uid: authUser.uid,
          displayName: authUser.displayName || authUser.email?.split('@')[0] || 'Workspace Admin',
          email: authUser.email || 'user@gradian.io',
          photoURL: authUser.photoURL,
          department: 'Digital Twin Governance',
          title: 'Workspace Owner (Signed In)',
          roleId: 'system-admin',
          groupIds: ['grp-qa-gmp', 'grp-bioprocess'],
          status: 'active',
          presence: isOnline ? 'online' : 'offline',
          lastActiveAt: nowLabel,
          isCurrentUser: true,
        };
        const nextUsers = [
          newMember,
          ...cur.users.map((u) => ({ ...u, isCurrentUser: false })),
        ];
        commit({ users: nextUsers });
      }
    },

    setCurrentUserOnline: (isOnline) => {
      const cur = get();
      const hasCurrent = cur.users.some((u) => u.isCurrentUser);
      if (!hasCurrent) return;
      commit({
        users: cur.users.map((u) =>
          u.isCurrentUser
            ? {
                ...u,
                presence: isOnline ? 'online' : 'offline',
                lastActiveAt: isOnline ? 'Online now' : 'Offline',
              }
            : u
        ),
      });
    },

    addUser: (user) => {
      const id = `usr-${Date.now().toString(36)}`;
      commit({
        users: [
          {
            ...user,
            id,
            lastActiveAt: user.presence === 'online' ? 'Online now' : 'Invited',
          },
          ...get().users,
        ],
      });
    },

    updateUser: (userId, patch) => {
      commit({
        users: get().users.map((u) => (u.id === userId ? { ...u, ...patch } : u)),
      });
    },

    toggleUserGroup: (userId, groupId) => {
      commit({
        users: get().users.map((u) => {
          if (u.id !== userId) return u;
          const has = u.groupIds.includes(groupId);
          return {
            ...u,
            groupIds: has ? u.groupIds.filter((g) => g !== groupId) : [...u.groupIds, groupId],
          };
        }),
      });
    },

    deleteUser: (userId) => {
      commit({
        users: get().users.filter((u) => u.id !== userId || u.isCurrentUser),
        rules: get().rules.filter((r) => !(r.principalKind === 'user' && r.principalId === userId)),
      });
    },

    addGroup: (group) => {
      const id = `grp-${Date.now().toString(36)}`;
      commit({
        groups: [
          ...get().groups,
          {
            ...group,
            id,
            createdAt: new Date().toISOString().slice(0, 10),
          },
        ],
      });
    },

    updateGroup: (groupId, patch) => {
      commit({
        groups: get().groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
      });
    },

    deleteGroup: (groupId) => {
      commit({
        groups: get().groups.filter((g) => g.id !== groupId),
        users: get().users.map((u) => ({
          ...u,
          groupIds: u.groupIds.filter((gid) => gid !== groupId),
        })),
        rules: get().rules.filter((r) => !(r.principalKind === 'group' && r.principalId === groupId)),
      });
    },

    toggleRolePermission: (roleId, permission) => {
      if (roleId === 'system-admin' && permission === 'acl.manage') return;
      commit({
        roles: get().roles.map((r) => {
          if (r.id !== roleId) return r;
          const has = r.permissions.includes(permission);
          return {
            ...r,
            permissions: has
              ? r.permissions.filter((p) => p !== permission)
              : [...r.permissions, permission],
          };
        }),
      });
    },

    addAclRule: (rule) => {
      const id = `acl-${Date.now().toString(36)}`;
      commit({
        rules: [
          {
            ...rule,
            id,
            updatedAt: new Date().toISOString().slice(0, 10),
          },
          ...get().rules,
        ],
      });
    },

    toggleAclRule: (ruleId) => {
      commit({
        rules: get().rules.map((r) =>
          r.id === ruleId ? { ...r, enabled: !r.enabled, updatedAt: new Date().toISOString().slice(0, 10) } : r
        ),
      });
    },

    updateAclRuleAccess: (ruleId, access) => {
      commit({
        rules: get().rules.map((r) =>
          r.id === ruleId ? { ...r, access, updatedAt: new Date().toISOString().slice(0, 10) } : r
        ),
      });
    },

    deleteAclRule: (ruleId) => {
      commit({
        rules: get().rules.filter((r) => r.id !== ruleId),
      });
    },

    openAclModal: (tab = 'users') => set({ showAclModal: true, aclTab: tab }),
    closeAclModal: () => set({ showAclModal: false }),
    setAclTab: (tab) => set({ aclTab: tab }),
  };
});
