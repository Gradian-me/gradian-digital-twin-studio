import { useEffect, useRef } from 'react';
import { useTwinStore } from '../store/useTwinStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { useGmpStore } from '../store/useGmpStore';
import { useRiskIncidentStore } from '../store/useRiskIncidentStore';
import { useAclStore } from '../store/useAclStore';

export type ModalRouteKey =
  | 'telemetry'
  | 'gmp'
  | 'fmea'
  | 'pdf'
  | 'qr'
  | 'scheduling'
  | 'acl'
  | 'racks'
  | 'cameras'
  | 'maya'
  | 'search'
  | 'models'
  | 'audit'
  | 'save'
  | 'export'
  | 'xr'
  | 'ai-planner'
  | 'cad-ocr'
  | 'entity';

interface RouteSnapshot {
  screen: 'hub' | 'workspace' | 'datacenter' | 'maya-life';
  floorId: string | null;
  modal: ModalRouteKey | null;
  telemetryTab?: string;
}

function getActiveModalKey(): { modal: ModalRouteKey | null; telemetryTab?: string } {
  const twin = useTwinStore.getState();
  const tel = useTelemetryStore.getState();
  const gmp = useGmpStore.getState();
  const risk = useRiskIncidentStore.getState();
  const acl = useAclStore.getState();

  if (risk.assetPdfModalOpen) return { modal: 'pdf' };
  if (risk.riskModalOpen) return { modal: 'fmea' };
  if (tel.dashboardOpen) return { modal: 'telemetry', telemetryTab: tel.dashboardTab };
  if (gmp.showQrLabelModal) return { modal: 'qr' };
  if (gmp.showGmpModal) return { modal: 'gmp' };
  if (gmp.showResourceSchedulingModal) return { modal: 'scheduling' };
  if (acl.showAclModal) return { modal: 'acl' };
  if (twin.entityInfoTarget) return { modal: 'entity' };
  if (twin.showNetworkRackModal) return { modal: 'racks' };
  if (twin.showCameraManager) return { modal: 'cameras' };
  if (twin.showSaveValidationModal) return { modal: 'save' };
  if (twin.showAuditTrailModal) return { modal: 'audit' };
  if (twin.showExportModal) return { modal: 'export' };
  if (twin.showXRModal) return { modal: 'xr' };
  if (twin.showAIPlannerModal) return { modal: 'ai-planner' };
  if (twin.showCadOcrModal) return { modal: 'cad-ocr' };
  if (twin.showModelsGallery) return { modal: 'models' };
  if (twin.showQuickSearch) return { modal: 'search' };
  if (twin.showMayaChat) return { modal: 'maya' };
  return { modal: null };
}

function computeCurrentRouteHash(): string {
  const twin = useTwinStore.getState();
  const { modal, telemetryTab } = getActiveModalKey();

  let base = '#/hub';
  if (twin.screen === 'datacenter') {
    base = '#/datacenter';
  } else if (twin.screen === 'maya-life') {
    base = '#/maya-life';
  } else if (twin.screen === 'workspace') {
    base = twin.activeFloorId
      ? `#/workspace/floor/${encodeURIComponent(twin.activeFloorId)}`
      : '#/workspace';
  }

  if (!modal) return base;
  if (modal === 'telemetry' && telemetryTab) {
    return `${base}?modal=telemetry&tab=${encodeURIComponent(telemetryTab)}`;
  }
  return `${base}?modal=${encodeURIComponent(modal)}`;
}

function parseRouteHash(rawHash: string): RouteSnapshot | null {
  if (!rawHash || rawHash === '#' || rawHash === '#/__root__') return null;
  const cleaned = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const [pathPart, queryPart] = cleaned.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart ?? '');
  const modalParam = (params.get('modal') as ModalRouteKey | null) || null;
  const telemetryTab = params.get('tab') || undefined;

  if (segments[0] === 'datacenter') {
    return { screen: 'datacenter', floorId: null, modal: modalParam, telemetryTab };
  }
  if (segments[0] === 'maya-life') {
    return { screen: 'maya-life', floorId: null, modal: modalParam, telemetryTab };
  }
  if (segments[0] === 'workspace') {
    const floorId =
      segments[1] === 'floor' && segments[2] ? decodeURIComponent(segments[2]) : null;
    return { screen: 'workspace', floorId, modal: modalParam, telemetryTab };
  }
  if (segments[0] === 'hub') {
    return { screen: 'hub', floorId: null, modal: modalParam, telemetryTab };
  }
  return null;
}

export function closeAllOpenModals(): boolean {
  const twin = useTwinStore.getState();
  const tel = useTelemetryStore.getState();
  const gmp = useGmpStore.getState();
  const risk = useRiskIncidentStore.getState();
  const acl = useAclStore.getState();

  let closedAny = false;
  if (risk.assetPdfModalOpen) {
    risk.closeAssetPdfModal();
    closedAny = true;
  }
  if (risk.riskModalOpen) {
    risk.closeRiskModal();
    closedAny = true;
  }
  if (tel.dashboardOpen) {
    tel.closeDashboard();
    closedAny = true;
  }
  if (gmp.showQrLabelModal) {
    gmp.closeQrLabelModal();
    closedAny = true;
  }
  if (gmp.showGmpModal) {
    gmp.closeGmpModal();
    closedAny = true;
  }
  if (gmp.showResourceSchedulingModal) {
    gmp.closeResourceSchedulingModal();
    closedAny = true;
  }
  if (acl.showAclModal) {
    acl.closeAclModal();
    closedAny = true;
  }
  if (twin.entityInfoTarget) {
    twin.closeEntityInfo();
    closedAny = true;
  }
  if (twin.showNetworkRackModal) {
    twin.closeRackDesigner();
    closedAny = true;
  }
  if (twin.showCameraManager) {
    twin.setShowCameraManager(false);
    closedAny = true;
  }
  if (twin.showSaveValidationModal) {
    twin.setShowSaveValidationModal(false);
    closedAny = true;
  }
  if (twin.showAuditTrailModal) {
    twin.setShowAuditTrailModal(false);
    closedAny = true;
  }
  if (twin.showExportModal) {
    twin.setShowExportModal(false);
    closedAny = true;
  }
  if (twin.showXRModal) {
    twin.setShowXRModal(false);
    closedAny = true;
  }
  if (twin.showAIPlannerModal) {
    twin.setShowAIPlannerModal(false);
    closedAny = true;
  }
  if (twin.showCadOcrModal) {
    twin.setShowCadOcrModal(false);
    closedAny = true;
  }
  if (twin.showModelsGallery) {
    twin.setShowModelsGallery(false);
    closedAny = true;
  }
  if (twin.showQuickSearch) {
    twin.setShowQuickSearch(false);
    closedAny = true;
  }
  if (twin.showMayaChat) {
    twin.setShowMayaChat(false);
    closedAny = true;
  }
  return closedAny;
}

function applyRouteToStores(route: RouteSnapshot) {
  const twin = useTwinStore.getState();
  const tel = useTelemetryStore.getState();
  const gmp = useGmpStore.getState();
  const risk = useRiskIncidentStore.getState();
  const acl = useAclStore.getState();

  // First close modals that don't match the target route
  const currentModal = getActiveModalKey().modal;
  if (currentModal !== route.modal) {
    closeAllOpenModals();
  }

  // Reconcile primary screen
  if (twin.screen !== route.screen) {
    twin.setScreen(route.screen);
  }
  if (route.screen === 'workspace' && route.floorId && twin.activeFloorId !== route.floorId) {
    const exists = twin.scene.floors.some((f) => f.id === route.floorId);
    if (exists) {
      twin.setActiveFloor(route.floorId);
    }
  }

  // Re-open target modal if navigating forward via browser Forward button or direct hash URL
  if (!route.modal || route.modal === currentModal) return;

  switch (route.modal) {
    case 'telemetry': {
      const validTabs = ['trends', 'equipment', 'predictive', 'define', 'relationships'] as const;
      const tab = validTabs.includes(route.telemetryTab as (typeof validTabs)[number])
        ? (route.telemetryTab as (typeof validTabs)[number])
        : 'trends';
      tel.openDashboard({ tab });
      break;
    }
    case 'gmp':
      gmp.openGmpModal();
      break;
    case 'fmea':
      risk.openRiskModal({ mode: 'heatmap' });
      break;
    case 'pdf':
      risk.openAssetPdfModal(null);
      break;
    case 'qr':
      gmp.openQrLabelModal();
      break;
    case 'scheduling':
      gmp.openResourceSchedulingModal();
      break;
    case 'acl':
      acl.openAclModal('users');
      break;
    case 'racks':
      twin.openRackDesigner();
      break;
    case 'cameras':
      twin.setShowCameraManager(true);
      break;
    case 'maya':
      twin.setShowMayaChat(true);
      break;
    case 'search':
      twin.setShowQuickSearch(true);
      break;
    case 'models':
      twin.setShowModelsGallery(true);
      break;
    case 'audit':
      twin.setShowAuditTrailModal(true);
      break;
    case 'save':
      twin.setShowSaveValidationModal(true);
      break;
    case 'export':
      twin.setShowExportModal(true);
      break;
    case 'xr':
      twin.setShowXRModal(true);
      break;
    case 'ai-planner':
      twin.setShowAIPlannerModal(true);
      break;
    case 'cad-ocr':
      twin.setShowCadOcrModal(true);
      break;
    case 'entity':
      // Entity info depends on an object reference; leave closed if popped back without state
      break;
  }
}

/**
 * Synchronizes app screens, active floors, and open dialogs with browser History API hash routes.
 * Ensures the browser/mobile Back button navigates cleanly inside the app (modal -> workspace -> hub)
 * and guards the root entry so pressing Back on the Home screen never exits/closes the app.
 */
export function useAppRouter(disabled = false) {
  const isReconcilingRef = useRef(false);
  const lastHashRef = useRef<string>('');
  const lastGuardToastRef = useRef<number>(0);

  useEffect(() => {
    if (disabled || typeof window === 'undefined') return;

    // 1. Honor initial hash route if present
    const initialParsed = parseRouteHash(window.location.hash);
    if (initialParsed) {
      isReconcilingRef.current = true;
      try {
        applyRouteToStores(initialParsed);
      } finally {
        isReconcilingRef.current = false;
      }
    }

    const startHash = computeCurrentRouteHash();
    lastHashRef.current = startHash;

    // 2. Seed a root sentinel history entry below the initial route so Back never exits the app
    try {
      const currentState = window.history.state as { appRoute?: string; appSentinel?: boolean } | null;
      if (!currentState?.appRoute && !currentState?.appSentinel) {
        window.history.replaceState({ appSentinel: true, route: '#/__root__' }, '', '#/__root__');
        window.history.pushState({ appRoute: startHash }, '', startHash);
      }
    } catch {
      // Sandboxed iframes with restricted history are handled gracefully
    }

    // 3. Push hash route whenever any tracked store state changes
    const syncStoreToHistory = () => {
      if (isReconcilingRef.current) return;
      const nextHash = computeCurrentRouteHash();
      if (nextHash === lastHashRef.current) return;
      lastHashRef.current = nextHash;
      try {
        window.history.pushState({ appRoute: nextHash }, '', nextHash);
      } catch {
        // Ignore SecurityError in restricted contexts
      }
    };

    const unsubTwin = useTwinStore.subscribe(syncStoreToHistory);
    const unsubTel = useTelemetryStore.subscribe(syncStoreToHistory);
    const unsubGmp = useGmpStore.subscribe(syncStoreToHistory);
    const unsubRisk = useRiskIncidentStore.subscribe(syncStoreToHistory);
    const unsubAcl = useAclStore.subscribe(syncStoreToHistory);

    // 4. Intercept browser/hardware Back & Forward via popstate
    const handlePopState = (ev: PopStateEvent) => {
      const state = ev.state as { appSentinel?: boolean; appRoute?: string } | null;

      // Hit the root guard sentinel — keep user inside the app!
      if (state?.appSentinel || window.location.hash === '#/__root__' || !window.location.hash) {
        isReconcilingRef.current = true;
        try {
          const closedModal = closeAllOpenModals();
          const twin = useTwinStore.getState();

          if (!closedModal && (twin.screen === 'datacenter' || twin.screen === 'maya-life')) {
            twin.setScreen('workspace');
          } else if (!closedModal && twin.screen === 'workspace') {
            twin.setScreen('hub');
          } else if (!closedModal && twin.screen === 'hub') {
            const now = Date.now();
            if (now - lastGuardToastRef.current > 2800) {
              lastGuardToastRef.current = now;
              twin.showToast(
                'You are at the Home Hub — use in-app controls to open a workspace or dialog.',
                'info'
              );
            }
          }

          const safeHash = computeCurrentRouteHash();
          lastHashRef.current = safeHash;
          try {
            window.history.pushState({ appRoute: safeHash }, '', safeHash);
          } catch {
            // ignore
          }
        } finally {
          isReconcilingRef.current = false;
        }
        return;
      }

      const targetHash = state?.appRoute || window.location.hash;
      const parsed = parseRouteHash(targetHash);
      if (!parsed) return;

      isReconcilingRef.current = true;
      try {
        applyRouteToStores(parsed);
        const settled = computeCurrentRouteHash();
        lastHashRef.current = settled;
      } finally {
        isReconcilingRef.current = false;
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      unsubTwin();
      unsubTel();
      unsubGmp();
      unsubRisk();
      unsubAcl();
      window.removeEventListener('popstate', handlePopState);
    };
  }, [disabled]);
}
