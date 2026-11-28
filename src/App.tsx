/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { ArrowLeftRight, Columns2, RotateCcw, Rows2, Undo2, X } from 'lucide-react';
import { AuthProvider } from './context/AuthContext';
import { useTwinStore } from './store/useTwinStore';
import { ProjectHub } from './components/ProjectHub';
import { TopToolbar } from './components/TopToolbar';
import { DesignStudioBar } from './components/DesignStudioBar';
import { PolygonSpaceNameModal } from './components/PolygonSpaceNameModal';
import { LeftBrowser } from './components/LeftBrowser';
import { RightInspector } from './components/RightInspector';
import { Viewport3D } from './components/Viewport3D';
import { Viewport2D } from './components/Viewport2D';
import { BottomTimelineBar } from './components/BottomTimelineBar';
import { ExportSnapshotsModal } from './components/ExportSnapshotsModal';
import { XRViewerModal } from './components/XRViewerModal';
import { OnboardingChecklist } from './components/OnboardingChecklist';
import { MobileShell } from './components/MobileShell';
import { AIPlannerPlaygroundModal } from './components/AIPlannerPlaygroundModal';
import { ModelsGalleryModal } from './components/ModelsGalleryModal';
import { GlobalQuickSearch } from './components/GlobalQuickSearch';
import { TelemetryDashboard } from './components/TelemetryDashboard';
import { MayaChatDrawer } from './components/MayaChatDrawer';
import { MayaLifePage } from './components/MayaLifePage';
import { CameraManagerModal } from './components/CameraManagerModal';
import { DataCenterDesignerPage, NetworkRackDesignerModal } from './components/NetworkRackDesignerModal';
import { SaveValidationModal } from './components/SaveValidationModal';
import { AuditTrailModal } from './components/AuditTrailModal';
import { MiniMapOverlay } from './components/MiniMapOverlay';
import { QrLabelStudioModal } from './components/QrLabelStudioModal';
import { GmpOperationsModal } from './components/GmpOperationsModal';
import { AclGroupingModal } from './components/AclGroupingModal';
import { FlowInfoDialog } from './components/FlowInfoDialog';
import { CadOcrWallModal } from './components/CadOcrWallModal';
import { ResourceSchedulingModal } from './components/ResourceSchedulingModal';
import { EntityInfoModal } from './components/EntityInfoModal';
import { RiskFmeaModal } from './components/RiskFmeaCenter';
import { AssetCompliancePdfModal } from './components/AssetCompliancePdfModal';
import { useTelemetryStore } from './store/useTelemetryStore';
import { useGmpStore } from './store/useGmpStore';
import { useRiskIncidentStore } from './store/useRiskIncidentStore';
import { useAclStore, canCurrentUserEditSpatial } from './store/useAclStore';
import { useAppRouter } from './utils/appRouter';

const WorkspaceShell: React.FC = () => {
  const screen = useTwinStore((s) => s.screen);
  const theme = useTwinStore((s) => s.theme);
  const viewMode = useTwinStore((s) => s.viewMode);
  const splitLayout = useTwinStore((s) => s.splitLayout);
  const updateSplitLayout = useTwinStore((s) => s.updateSplitLayout);
  const leftPanelOpen = useTwinStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useTwinStore((s) => s.rightPanelOpen);
  const toast = useTwinStore((s) => s.toast);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const dismissToast = useTwinStore((s) => s.dismissToast);
  const undo = useTwinStore((s) => s.undo);
  const sceneId = useTwinStore((s) => s.scene.id);
  const sceneAssetCount = useTwinStore((s) => s.scene.assets.length);
  const autoSaveEnabled = useTwinStore((s) => s.autoSaveEnabled);
  const streamRunning = useTelemetryStore((s) => s.streamRunning);
  const telemetryLastUpdated = useTelemetryStore((s) => s.serverTime);
  const workspaceMode = useTwinStore((s) => s.workspaceMode);
  const aclUsers = useAclStore((s) => s.users);
  const aclRoles = useAclStore((s) => s.roles);
  const aclGroups = useAclStore((s) => s.groups);
  const activeAclUserId = useAclStore((s) => s.activeAclUserId);

  // Enforce strict ACL read-only lock: immediately downgrade to View mode if active ACL user lacks spatial.edit
  useEffect(() => {
    if (workspaceMode === 'design' && !canCurrentUserEditSpatial()) {
      useTwinStore.setState({ workspaceMode: 'view', activeTool: 'select', editingFlowId: null });
    }
  }, [workspaceMode, aclUsers, aclRoles, aclGroups, activeAclUserId]);

  // Detect dedicated new-tab Telemetry Dashboard mode (?mode=telemetry)
  const isStandaloneTelemetry = (() => {
    try {
      return new URLSearchParams(window.location.search).get('mode') === 'telemetry';
    } catch {
      return false;
    }
  })();

  // Synchronize screens, floors, and dialogs with browser history routes (Back never exits app)
  useAppRouter(isStandaloneTelemetry);

  // Sync dark/light class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Apply Direct URL deep-link (?project=...&building=...&floor=...&room=...&asset=...&layer=...&isolateType=... or ?mode=telemetry)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'telemetry') {
      const tab = params.get('tab') as any;
      useTelemetryStore.getState().openDashboard({
        tab: tab && ['trends', 'equipment', 'predictive', 'define', 'relationships'].includes(tab) ? tab : 'trends',
        assetId: params.get('assetId'),
        roomId: params.get('roomId'),
        sensorId: params.get('sensorId'),
      });
    } else {
      useTwinStore.getState().applyUrlDeepLink();
    }
  }, []);

  // Real-Time Environmental & Equipment Telemetry Mock DB Polling Loop (1.5s)
  useEffect(() => {
    const tel = useTelemetryStore.getState();
    tel.fetchLiveSnapshot(useTwinStore.getState().scene);
    if (!streamRunning) return;
    const timer = window.setInterval(() => {
      useTelemetryStore.getState().fetchLiveSnapshot(useTwinStore.getState().scene);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [streamRunning]);

  // Keep GMP Compliance, Production Lines & Work Order store synced with scene assets
  useEffect(() => {
    const scene = useTwinStore.getState().scene;
    useGmpStore.getState().syncWithScene(scene);
    useRiskIncidentStore.getState().reconcileWithScene(scene, useGmpStore.getState().productionLines);
  }, [sceneId, sceneAssetCount]);

  // Automatic telemetry alarm & drift incident logging into FMEA Risk Register
  useEffect(() => {
    if (!telemetryLastUpdated) return;
    const tel = useTelemetryStore.getState();
    const scene = useTwinStore.getState().scene;
    useRiskIncidentStore.getState().syncTelemetryAnomalies(tel.sensors, tel.readings, scene);
  }, [telemetryLastUpdated]);

  // Global Ctrl+K / Cmd+K Quick Search Shortcut (works from Hub and Workspace)
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const st = useTwinStore.getState();
        st.setShowQuickSearch(!st.showQuickSearch);
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  // Auto-save 60-second inactivity watcher → launches Save & Validation workflow
  useEffect(() => {
    if (screen !== 'workspace' || !autoSaveEnabled) {
      useTwinStore.getState().setAutoSaveSecondsLeft(60);
      return;
    }

    const INACTIVITY_SECONDS = 60;
    let lastActiveAt = Date.now();
    let lastMoveReset = 0;

    const resetInactivity = () => {
      lastActiveAt = Date.now();
      if (useTwinStore.getState().autoSaveSecondsLeft !== INACTIVITY_SECONDS) {
        useTwinStore.getState().setAutoSaveSecondsLeft(INACTIVITY_SECONDS);
      }
    };

    const onPointerMove = () => {
      const now = Date.now();
      if (now - lastMoveReset > 1500) {
        lastMoveReset = now;
        resetInactivity();
      }
    };

    const activityEvents: (keyof WindowEventMap)[] = [
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart',
      'input',
    ];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetInactivity, { passive: true }));
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const interval = window.setInterval(() => {
      const st = useTwinStore.getState();
      if (!st.autoSaveEnabled || st.screen !== 'workspace') return;

      // Pause & reset timer while SaveValidationModal is already open
      if (st.showSaveValidationModal) {
        lastActiveAt = Date.now();
        if (st.autoSaveSecondsLeft !== INACTIVITY_SECONDS) {
          st.setAutoSaveSecondsLeft(INACTIVITY_SECONDS);
        }
        return;
      }

      const elapsed = Math.floor((Date.now() - lastActiveAt) / 1000);
      const remaining = Math.max(0, INACTIVITY_SECONDS - elapsed);

      if (remaining <= 0) {
        lastActiveAt = Date.now();
        st.setAutoSaveSecondsLeft(INACTIVITY_SECONDS);
        st.refreshValidation();
        st.setShowSaveValidationModal(true);
        st.recordAudit({
          category: 'save',
          action: 'Auto-save Validation Triggered (60s Inactivity)',
          entityType: 'project',
          entityId: st.scene.id,
          entityName: st.scene.name,
          summary: 'Automatically opened GMP Save & Validation workflow after 60 seconds of inactivity.',
        });
        st.showToast('Auto-save: 60s inactivity reached — launching Save & Validation', 'info');
      } else if (st.autoSaveSecondsLeft !== remaining) {
        st.setAutoSaveSecondsLeft(remaining);
      }
    }, 1000);

    return () => {
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetInactivity));
      window.removeEventListener('pointermove', onPointerMove);
      window.clearInterval(interval);
    };
  }, [screen, autoSaveEnabled]);

  // Auto-dismiss transient toasts
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      useTwinStore.getState().dismissToast();
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Global CAD Keyboard Shortcuts inside Workspace
  useEffect(() => {
    if (screen !== 'workspace') return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const state = useTwinStore.getState();

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        state.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        state.duplicateSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        state.refreshValidation();
        state.setShowSaveValidationModal(true);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selected.length > 0) {
          e.preventDefault();
          state.deleteSelected();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (state.pendingPolygonSpace) {
          state.setPendingPolygonSpace(null);
          return;
        }
        // First Escape stops the active continuous wall chain while keeping Wall tool ready
        if (state.activeTool === 'draw-wall' && state.wallChainAnchor) {
          state.setWallChainAnchor(null);
          return;
        }
        state.setActiveTool('select');
        state.clearSelection();
        state.clearMeasure();
        if (state.calibratingRefId) state.cancelCalibration();
        return;
      }

      // Skip single-key tool shortcuts while walking in First-Person mode
      if (state.firstPersonMode) return;

      switch (e.key.toLowerCase()) {
        case 'v':
          state.setActiveTool('select');
          break;
        case 'r':
          state.setActiveTool('draw-room');
          state.setLeftTab('spaces');
          break;
        case 'w':
          state.setActiveTool('draw-wall');
          break;
        case 'd':
          state.setActiveTool('place-door');
          break;
        case 'n':
          state.setActiveTool('place-window');
          break;
        case 'e':
          state.setActiveTool('place-object');
          state.setLeftTab('objects');
          break;
        case 'b':
          state.setActiveTool('paint-material');
          state.setRightTab('materials');
          break;
        case 'f':
          state.setActiveTool('draw-flow');
          state.setRightTab('flows');
          break;
        case 'c':
          state.setActiveTool('place-camera');
          break;
        case 'm':
          state.setActiveTool('measure');
          break;
        case 'h':
          state.setScreen('hub');
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen]);

  if (isStandaloneTelemetry) {
    return <TelemetryDashboard standalone />;
  }

  return (
    <>
      {screen === 'hub' ? (
        <ProjectHub />
      ) : screen === 'datacenter' ? (
        <DataCenterDesignerPage />
      ) : screen === 'maya-life' ? (
        <MayaLifePage />
      ) : (
        <>
          {/* Dedicated Mobile Viewer-First Shell (< md) */}
          <MobileShell />

          {/* Desktop & Tablet Professional CAD Workspace (>= md) */}
          <div className="hidden md:flex flex-col h-screen w-screen overflow-hidden bg-zinc-100 dark:bg-[#09090B] text-zinc-900 dark:text-zinc-100 select-none">
            <TopToolbar />
            <DesignStudioBar />
            <PolygonSpaceNameModal />

            <div className="flex-1 flex min-h-0 overflow-hidden">
              {leftPanelOpen && <LeftBrowser />}

              {/* Primary Spatial Viewport (2D, 3D Perspective, 3D Ortho, or Split-Screen) */}
              <main className="flex-1 min-w-0 min-h-0 relative flex overflow-hidden">
                {viewMode === '2d' && (
                  <div className="w-full h-full">
                    <Viewport2D />
                  </div>
                )}

                {(viewMode === '3d-perspective' || viewMode === '3d-ortho') && (
                  <div className="w-full h-full">
                    <Viewport3D />
                  </div>
                )}

                {viewMode === 'split' && (
                  <div
                    ref={splitContainerRef}
                    className={`w-full h-full flex relative ${
                      splitLayout.orientation === 'vertical' ? 'flex-col' : 'flex-row'
                    }`}
                  >
                    {/* First Pane */}
                    <div
                      className="min-w-0 min-h-0 relative overflow-hidden"
                      style={{
                        flexBasis: `${Math.round(splitLayout.ratio * 100)}%`,
                        flexGrow: 0,
                        flexShrink: 0,
                      }}
                    >
                      {splitLayout.flipped ? <Viewport3D /> : <Viewport2D />}
                    </div>

                    {/* Interactive Draggable Divider + Split Controls */}
                    <div
                      role="separator"
                      aria-orientation={splitLayout.orientation}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        const container = splitContainerRef.current;
                        if (!container) return;
                        const rect = container.getBoundingClientRect();
                        const onMove = (ev: PointerEvent) => {
                          const raw =
                            splitLayout.orientation === 'vertical'
                              ? (ev.clientY - rect.top) / Math.max(1, rect.height)
                              : (ev.clientX - rect.left) / Math.max(1, rect.width);
                          updateSplitLayout({ ratio: Number(Math.max(0.2, Math.min(0.8, raw)).toFixed(3)) });
                        };
                        const onUp = () => {
                          window.removeEventListener('pointermove', onMove);
                          window.removeEventListener('pointerup', onUp);
                        };
                        window.addEventListener('pointermove', onMove);
                        window.addEventListener('pointerup', onUp);
                      }}
                      className={`relative z-30 flex items-center justify-center shrink-0 bg-zinc-200 dark:bg-zinc-800 hover:bg-violet-500 transition-colors ${
                        splitLayout.orientation === 'vertical'
                          ? 'h-1.5 w-full cursor-row-resize'
                          : 'w-1.5 h-full cursor-col-resize'
                      }`}
                      title="Drag to resize Split View panes"
                    >
                      <div
                        onPointerDown={(e) => e.stopPropagation()}
                        className="absolute flex items-center gap-0.5 p-1 rounded-xl bg-white dark:bg-[#14141C] border border-zinc-200 dark:border-zinc-700 shadow-2xl text-[10px]"
                      >
                        <button
                          onClick={() => updateSplitLayout({ flipped: !splitLayout.flipped })}
                          className="p-1 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-violet-600 hover:text-white transition-colors"
                          title={`Flip / Swap Panes (${splitLayout.flipped ? '3D | 2D' : '2D | 3D'})`}
                        >
                          <ArrowLeftRight className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() =>
                            updateSplitLayout({
                              orientation:
                                splitLayout.orientation === 'horizontal' ? 'vertical' : 'horizontal',
                            })
                          }
                          className="p-1 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-violet-600 hover:text-white transition-colors"
                          title={
                            splitLayout.orientation === 'horizontal'
                              ? 'Switch to Top / Bottom Split'
                              : 'Switch to Left / Right Split'
                          }
                        >
                          {splitLayout.orientation === 'horizontal' ? (
                            <Rows2 className="w-3 h-3" />
                          ) : (
                            <Columns2 className="w-3 h-3" />
                          )}
                        </button>
                        <button
                          onClick={() => updateSplitLayout({ ratio: 0.5 })}
                          className="p-1 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-amber-500 hover:text-zinc-950 transition-colors"
                          title="Reset Split 50/50"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Second Pane */}
                    <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden">
                      {splitLayout.flipped ? <Viewport2D /> : <Viewport3D />}
                    </div>
                  </div>
                )}

                {/* Draggable Birds-Eye Spatial Mini-Map Overlay */}
                <MiniMapOverlay />
              </main>

              {rightPanelOpen && <RightInspector />}
            </div>

            <BottomTimelineBar />
          </div>

          <ExportSnapshotsModal />
          <XRViewerModal />
          <OnboardingChecklist />
        </>
      )}

      {/* Modals & Full-Screen Consoles available from both Hub and Workspace */}
      <AIPlannerPlaygroundModal />
      <ModelsGalleryModal />
      <GlobalQuickSearch />
      <TelemetryDashboard />
      <MayaChatDrawer />
      <CameraManagerModal />
      <NetworkRackDesignerModal />
      <SaveValidationModal />
      <AuditTrailModal />
      <QrLabelStudioModal />
      <GmpOperationsModal />
      <AclGroupingModal />
      <FlowInfoDialog />
      <CadOcrWallModal />
      <ResourceSchedulingModal />
      <EntityInfoModal />
      <RiskFmeaModal />
      <AssetCompliancePdfModal />

      {/* Global Toast Notification (top-center, clear of menus & bottom hover cards) */}
      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[70] px-3.5 py-2 rounded-2xl shadow-2xl border bg-[#14141A]/95 backdrop-blur-md text-zinc-100 border-zinc-700/90 flex items-center gap-2.5 text-xs max-w-[min(92vw,420px)] pointer-events-auto">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              toast.tone === 'error'
                ? 'bg-rose-400'
                : toast.tone === 'warning'
                  ? 'bg-amber-400'
                  : toast.tone === 'success'
                    ? 'bg-emerald-400'
                    : 'bg-violet-400'
            }`}
          />
          <span className="truncate">{toast.message}</span>
          {toast.canUndo && (
            <button
              onClick={undo}
              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium whitespace-nowrap shrink-0 transition-colors"
            >
              <Undo2 className="w-3 h-3" />
              Undo
            </button>
          )}
          <button
            onClick={dismissToast}
            className="text-zinc-400 hover:text-white shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceShell />
    </AuthProvider>
  );
}
