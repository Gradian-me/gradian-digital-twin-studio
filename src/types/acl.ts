export type AclPermissionKey =
  | 'spatial.view'
  | 'spatial.edit'
  | 'spatial.delete'
  | 'spatial.export'
  | 'gmp.eligibility_check'
  | 'gmp.edit_compliance'
  | 'gmp.manage_workorders'
  | 'gmp.approve_sops'
  | 'telemetry.view'
  | 'telemetry.manage_sensors'
  | 'cameras.view_live'
  | 'acl.manage';

export type AclRoleId =
  | 'system-admin'
  | 'facility-architect'
  | 'qa-compliance'
  | 'maintenance-engineer'
  | 'scada-operator'
  | 'auditor-readonly';

export interface AclPermissionMeta {
  key: AclPermissionKey;
  label: string;
  domain: 'Spatial & CAD' | 'GMP & Compliance' | 'Telemetry & Security';
  description: string;
}

export interface AclRoleDefinition {
  id: AclRoleId;
  name: string;
  description: string;
  color: string;
  badgeClass: string;
  permissions: AclPermissionKey[];
  systemProtected?: boolean;
}

export interface AclUserMember {
  id: string;
  uid?: string;
  displayName: string;
  email: string;
  photoURL?: string | null;
  department: string;
  title: string;
  roleId: AclRoleId;
  groupIds: string[];
  status: 'active' | 'suspended';
  presence: 'online' | 'offline' | 'away';
  lastActiveAt: string;
  isCurrentUser?: boolean;
}

export interface AclGroup {
  id: string;
  name: string;
  code: string;
  description: string;
  color: string;
  defaultRoleId: AclRoleId;
  spatialScope: 'all-site' | 'building' | 'floor' | 'production-line';
  spatialScopeLabel: string;
  spatialTargetIds: string[];
  createdAt: string;
}

export type AclResourceKind =
  | 'building'
  | 'floor'
  | 'room'
  | 'production-line'
  | 'module';

export type AclAccessEffect = 'admin' | 'write' | 'read' | 'deny';

export interface AclResourceRule {
  id: string;
  resourceKind: AclResourceKind;
  resourceId: string;
  resourceName: string;
  principalKind: 'group' | 'user';
  principalId: string;
  access: AclAccessEffect;
  enabled: boolean;
  reason: string;
  updatedAt: string;
}

export type AclModalTab = 'users' | 'groups' | 'roles' | 'acls';
