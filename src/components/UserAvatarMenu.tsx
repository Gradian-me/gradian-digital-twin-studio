import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  CloudUpload,
  KeyRound,
  LogIn,
  LogOut,
  Moon,
  Shield,
  ShieldCheck,
  Sun,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { computeEffectivePermissions, useAclStore } from '../store/useAclStore';

interface UserAvatarMenuProps {
  compact?: boolean;
  onCloudSync?: () => void;
  savingCloud?: boolean;
}

function getInitials(name?: string | null, email?: string | null): string {
  const source = (name || email || 'U').trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export const UserAvatarMenu: React.FC<UserAvatarMenuProps> = ({
  compact = false,
  onCloudSync,
  savingCloud = false,
}) => {
  const { user, signInWithGoogle, signOut } = useAuth();
  const theme = useTwinStore((s) => s.theme);
  const toggleTheme = useTwinStore((s) => s.toggleTheme);
  const setShowAuditTrailModal = useTwinStore((s) => s.setShowAuditTrailModal);
  const openGmpModal = useGmpStore((s) => s.openGmpModal);

  const roles = useAclStore((s) => s.roles);
  const groups = useAclStore((s) => s.groups);
  const users = useAclStore((s) => s.users);
  const openAclModal = useAclStore((s) => s.openAclModal);
  const syncAuthUser = useAclStore((s) => s.syncAuthUser);
  const setCurrentUserOnline = useAclStore((s) => s.setCurrentUserOnline);

  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Track real-time browser online/offline network status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setCurrentUserOnline(true);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setCurrentUserOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setCurrentUserOnline]);

  // Sync Firebase Auth logged-in user into ACL directory
  useEffect(() => {
    setImgFailed(false);
    syncAuthUser(
      user
        ? {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
          }
        : null,
      isOnline
    );
  }, [user, isOnline, syncAuthUser]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const currentMember = useMemo(
    () => users.find((u) => u.isCurrentUser || (user && u.uid === user.uid)),
    [users, user]
  );

  const activeRole = useMemo(
    () => roles.find((r) => r.id === (currentMember?.roleId ?? 'system-admin')),
    [roles, currentMember]
  );

  const memberGroups = useMemo(
    () => groups.filter((g) => currentMember?.groupIds.includes(g.id)),
    [groups, currentMember]
  );

  const effectivePermsCount = useMemo(
    () => computeEffectivePermissions(currentMember, roles, groups).length,
    [currentMember, roles, groups]
  );

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Guest Operator';
  const email = user?.email || 'Local Workspace Session';
  const initials = getInitials(user?.displayName, user?.email);
  const showPhoto = Boolean(user?.photoURL && !imgFailed);

  // Logged-out view: Sign In button + live Online/Offline dot + quick ACL menu access
  if (!user) {
    return (
      <div ref={containerRef} className="relative flex items-center gap-1.5 shrink-0">
        {/* Live Online / Offline Status Pill */}
        <span
          className={`hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl border text-[11px] font-medium whitespace-nowrap ${
            isOnline
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-rose-500/40 bg-rose-500/12 text-rose-600 dark:text-rose-400'
          }`}
          title={isOnline ? 'Connected — Online' : 'Disconnected — Offline Mode'}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
            }`}
          />
          <span className="hidden xl:inline">{isOnline ? 'Online' : 'Offline'}</span>
        </span>

        <button
          type="button"
          onClick={() => openAclModal('users')}
          className="h-9 px-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] hover:border-violet-500/60 text-zinc-700 dark:text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          title="Open ACL, Roles & User Grouping"
        >
          <Shield className="w-3.5 h-3.5 text-violet-500" />
          {!compact && <span className="hidden lg:inline">ACL</span>}
        </button>

        <button
          type="button"
          onClick={signInWithGoogle}
          className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 text-xs font-semibold transition-opacity whitespace-nowrap cursor-pointer"
          title="Sign in with Google"
        >
          <LogIn className="w-3.5 h-3.5" />
          {!compact && <span className="hidden sm:inline">Sign In</span>}
        </button>
      </div>
    );
  }

  // Logged-in view: User Avatar + Online/Offline Indicator + Interactive Dropdown Menu
  return (
    <div ref={containerRef} className="relative flex items-center shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={`flex items-center gap-2 h-9 pl-1.5 pr-2 sm:pr-2.5 rounded-xl border transition-colors cursor-pointer ${
          menuOpen
            ? 'border-violet-500 bg-violet-500/12'
            : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#18181F] hover:border-violet-500/60'
        }`}
        title={`${displayName} (${email}) — ${isOnline ? 'Online' : 'Offline'}`}
      >
        {/* Avatar with corner Online/Offline indicator ring */}
        <div className="relative shrink-0">
          {showPhoto ? (
            <img
              src={user.photoURL!}
              alt={displayName}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-7 h-7 rounded-full object-cover ring-2 ring-violet-500/40"
            />
          ) : (
            <div className="w-7 h-7 rounded-full gradian-violet-amber text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-violet-500/30">
              {initials}
            </div>
          )}
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-[#18181F] ${
              isOnline ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
            aria-label={isOnline ? 'Online' : 'Offline'}
          />
        </div>

        {/* Name + Explicit Online/Offline status next to avatar */}
        {!compact && (
          <div className="hidden md:flex flex-col items-start leading-tight max-w-[118px] min-w-0">
            <span className="text-[11.5px] font-semibold text-zinc-900 dark:text-zinc-100 truncate w-full text-left">
              {displayName}
            </span>
            <span
              className={`text-[9.5px] font-medium flex items-center gap-1 ${
                isOnline
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-500 dark:text-rose-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isOnline ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        )}

        {!compact && <ChevronDown className="w-3 h-3 text-zinc-400 hidden sm:block shrink-0" />}
      </button>

      {/* Rich Profile, Online Status, ACL & Grouping Dropdown Menu */}
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-76 rounded-2xl bg-white dark:bg-[#15151C] border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden z-50"
        >
          {/* Profile Header */}
          <div className="p-3.5 bg-zinc-50 dark:bg-[#1A1A24] border-b border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                {showPhoto ? (
                  <img
                    src={user.photoURL!}
                    alt={displayName}
                    referrerPolicy="no-referrer"
                    onError={() => setImgFailed(true)}
                    className="w-11 h-11 rounded-full object-cover ring-2 ring-violet-500/50"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full gradian-violet-amber text-white text-sm font-bold flex items-center justify-center ring-2 ring-violet-500/40">
                    {initials}
                  </div>
                )}
                <span
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-zinc-50 dark:ring-[#1A1A24] ${
                    isOnline ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                  {displayName}
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                  {email}
                </div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      isOnline
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                    }`}
                  >
                    {isOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
                    {isOnline ? 'Online · Synced' : 'Offline · Local'}
                  </span>
                  {activeRole && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${activeRole.badgeClass}`}
                    >
                      <Shield className="w-2.5 h-2.5" />
                      {activeRole.name}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Active Groups */}
            {memberGroups.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 pt-1">
                <span className="text-[10px] text-zinc-400 mr-1">Groups:</span>
                {memberGroups.map((g) => (
                  <span
                    key={g.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-zinc-200/70 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.color }} />
                    {g.code}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-[10.5px] text-zinc-500 dark:text-zinc-400 pt-1 border-t border-zinc-200/70 dark:border-zinc-800">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                {effectivePermsCount} / 12 ACL permissions active
              </span>
              <span className="font-mono text-[10px] text-violet-500">RBAC + ACL</span>
            </div>
          </div>

          {/* ACL & Grouping Section */}
          <div className="p-2 space-y-1">
            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Access Control &amp; Grouping
            </div>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openAclModal('users');
              }}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-violet-500/12 hover:text-violet-600 dark:hover:text-violet-300 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <Users className="w-4 h-4 text-violet-500" />
                <span>Users &amp; Group Memberships</span>
              </span>
              <span className="font-mono text-[10px] text-zinc-400">{users.length}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openAclModal('groups');
              }}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-amber-500/12 hover:text-amber-600 dark:hover:text-amber-300 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-amber-500" />
                <span>User Groups &amp; Spatial Scopes</span>
              </span>
              <span className="font-mono text-[10px] text-zinc-400">{groups.length}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openAclModal('acls');
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-emerald-500/12 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors cursor-pointer"
            >
              <KeyRound className="w-4 h-4 text-emerald-500" />
              <span>Resource ACL Rules &amp; Simulator</span>
            </button>

            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />

            {/* Workspace Actions */}
            {onCloudSync && (
              <button
                type="button"
                disabled={savingCloud || !isOnline}
                onClick={() => {
                  setMenuOpen(false);
                  onCloudSync();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-45 transition-colors cursor-pointer"
              >
                <CloudUpload className="w-4 h-4 text-emerald-500" />
                <span>
                  {!isOnline
                    ? 'Cloud Sync Unavailable (Offline)'
                    : savingCloud
                      ? 'Syncing to Cloud SQL...'
                      : 'Sync Workspace to Cloud'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openGmpModal({ tab: 'lines' });
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ClipboardCheck className="w-4 h-4 text-emerald-500" />
              <span>GMP Compliance &amp; Production Lines</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setShowAuditTrailModal(true);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-amber-500" />
              <span>21 CFR Part 11 Audit Trail</span>
            </button>

            <button
              type="button"
              onClick={() => {
                toggleTheme();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-violet-500" />
              )}
              <span>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Charcoal'}</span>
            </button>

            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                signOut();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
