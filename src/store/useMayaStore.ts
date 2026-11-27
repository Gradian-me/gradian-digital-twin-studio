import { create } from 'zustand';
import type { MayaExpressionName, MayaStateName } from '../lib/mayaController';
import type { ProposedAIAction } from '../types/twin';

export type MayaInteractionKind = 'room' | 'equipment' | 'door' | 'light' | 'sop' | 'chat' | 'voice';

export interface MayaInteractionEntry {
  id: string;
  timestamp: string;
  kind: MayaInteractionKind;
  targetId: string;
  targetCode: string;
  targetName: string;
  summary: string;
  mayaState: MayaStateName;
  roomId?: string | null;
  sopId?: string | null;
}

export interface MayaWorkflowEvent {
  id: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  kind: MayaInteractionKind;
  action: string;
  targetCode: string;
  targetName: string;
  fromState: MayaStateName;
  toState: MayaStateName;
  status: 'running' | 'completed' | 'cancelled';
  roomId?: string | null;
  sopId?: string | null;
}

export interface SavedWalkPose {
  floorId: string;
  x: number;
  z: number;
  yaw: number;
  camYaw: number;
  pitch: number;
  cameraMode: 'first-person' | 'third-person';
  roomId?: string | null;
  roomCode?: string | null;
  roomName?: string | null;
  savedAt: string;
}

export interface MayaLifeNavTarget {
  type: 'room' | 'asset' | 'floor' | 'building' | 'sop';
  id?: string;
  code: string;
  name: string;
  reason?: string;
}

export interface MayaLifeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  mayaState?: MayaStateName;
  mayaExpression?: MayaExpressionName;
  statusNote?: string;
  citedSopCodes?: string[];
  navigationTargets?: MayaLifeNavTarget[];
  suggestedPrompts?: string[];
  modelUsed?: string;
}

export interface MayaLifeThread {
  id: string;
  title: string;
  titleGenerated?: boolean;
  createdAt: string;
  updatedAt: string;
  messages: MayaLifeMessage[];
}

export interface MayaDrawerChartDatum {
  label: string;
  value: number;
  target?: number;
  color?: string;
}

export interface MayaDrawerChartSpec {
  title: string;
  subtitle?: string;
  kind: 'bar' | 'line' | 'area' | 'pie' | 'target' | 'composed' | 'kpi' | string;
  unit?: string;
  data: MayaDrawerChartDatum[];
}

export interface MayaDrawerEntityRef {
  type: 'room' | 'asset' | 'floor' | 'building' | 'camera' | 'flow';
  id: string;
  code: string;
  name: string;
  reason?: string;
  floorCode?: string;
}

export interface MayaDrawerMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  highlightTitle?: string;
  charts?: MayaDrawerChartSpec[];
  proposedActions?: ProposedAIAction[];
  navigationTargets?: MayaDrawerEntityRef[];
  applied?: boolean;
  appliedCount?: number;
  appliedComment?: string;
  createdEntities?: MayaDrawerEntityRef[];
  followUpSuggestions?: string[];
  modelUsed?: string;
  error?: boolean;
  retryPrompt?: string;
}

export interface MayaDrawerThread {
  id: string;
  title: string;
  titleGenerated?: boolean;
  createdAt: string;
  updatedAt: string;
  messages: MayaDrawerMessage[];
}

const MAYA_STORAGE_KEY = 'gradian_maya_life_v2';

interface PersistedMayaData {
  interactions: MayaInteractionEntry[];
  workflowEvents: MayaWorkflowEvent[];
  lifeThreads: MayaLifeThread[];
  activeLifeThreadId: string;
  drawerThreads: MayaDrawerThread[];
  activeDrawerThreadId: string;
  roomLights: Record<string, boolean>;
  switchStates: Record<string, boolean>;
  openDoors: Record<string, boolean>;
  savedWalkPose: SavedWalkPose | null;
}

function loadMayaState(): Partial<PersistedMayaData> {
  try {
    const raw = localStorage.getItem(MAYA_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    // Migrate v1 seamlessly if present
    const v1 = localStorage.getItem('gradian_maya_life_v1');
    if (v1) {
      const parsed = JSON.parse(v1);
      return {
        interactions: parsed.interactions ?? [],
        roomLights: parsed.roomLights ?? {},
        openDoors: parsed.openDoors ?? {},
      };
    }
    return {};
  } catch {
    return {};
  }
}

function saveMayaState(data: PersistedMayaData) {
  try {
    localStorage.setItem(MAYA_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage quota
  }
}

export const DEFAULT_LIFE_GREETING: MayaLifeMessage = {
  id: 'maya-life-welcome',
  role: 'assistant',
  content:
    "Hi, I'm **MAYA** — your facility's Digital Twin Specialist & GMP Companion. Walk with me through rooms, press **Enter** beside doors, wall light switches, or equipment to interact, or ask me about any SOP, HVAC cascade, fire safety inventory, camera, or equipment status!",
  timestamp: new Date().toISOString(),
  mayaState: 'wave',
  mayaExpression: 'happy',
  statusNote: 'Ready to explore the facility & guide GMP operations',
  suggestedPrompts: [
    'Summarize all critical equipment SOPs & safety limits',
    'Which rooms have overdue fire safety or compliance checks?',
    'Walk me through Bioreactor CIP/SIP operating steps',
    'Inspect HVAC pressure cascade across Grade B/C cleanrooms',
  ],
};

export const DEFAULT_DRAWER_GREETING: MayaDrawerMessage = {
  id: 'maya-welcome',
  role: 'assistant',
  content:
    "Hi! I'm **MAYA**, your Gradian.me Facility & GMP Specialist. Ask me anything about rooms, equipment, FMEA risks, live telemetry, SOPs, or request layout actions and charts.",
  followUpSuggestions: [
    'Check production line GMP eligibility',
    'Top FMEA risks ranked by RPN chart',
    'Energy usage by room (bar chart)',
    'Highlight high-energy HVAC equipment',
  ],
};

function makeInitialLifeThread(): MayaLifeThread {
  const now = new Date().toISOString();
  return {
    id: `mlt-${Date.now()}-init`,
    title: 'Facility Operations Briefing',
    titleGenerated: false,
    createdAt: now,
    updatedAt: now,
    messages: [DEFAULT_LIFE_GREETING],
  };
}

function makeInitialDrawerThread(): MayaDrawerThread {
  const now = new Date().toISOString();
  return {
    id: `mdt-${Date.now()}-init`,
    title: 'New MAYA Consultation',
    titleGenerated: false,
    createdAt: now,
    updatedAt: now,
    messages: [DEFAULT_DRAWER_GREETING],
  };
}

// Track active auto-return timers outside React state so MAYA never gets stuck in an intermediate state
let stateResetTimer: ReturnType<typeof setTimeout> | null = null;
let sopFinishTimer: ReturnType<typeof setTimeout> | null = null;

function clearStateTimers() {
  if (stateResetTimer) {
    clearTimeout(stateResetTimer);
    stateResetTimer = null;
  }
}

interface MayaDomainState {
  currentState: MayaStateName;
  currentExpression: MayaExpressionName;
  statusNote: string;
  isThinking: boolean;
  isReadingSop: boolean;
  activeWorkflowId: string | null;
  activeRoomId: string | null;
  activeRoomCode: string | null;
  activeRoomName: string | null;
  activeAssetId: string | null;
  activeSopId: string | null;
  openDoors: Record<string, boolean>;
  roomLights: Record<string, boolean>;
  switchStates: Record<string, boolean>;
  interactions: MayaInteractionEntry[];
  workflowEvents: MayaWorkflowEvent[];
  savedWalkPose: SavedWalkPose | null;
  pendingRestoreWalkPose: boolean;

  // Dedicated Multi-Thread Chats (MAYA Life)
  lifeThreads: MayaLifeThread[];
  activeLifeThreadId: string;
  lifeChatMessages: MayaLifeMessage[];

  // Dedicated Multi-Thread Chats (MAYA Drawer)
  drawerThreads: MayaDrawerThread[];
  activeDrawerThreadId: string;

  setMood: (
    state: MayaStateName,
    expression?: MayaExpressionName,
    statusNote?: string,
    autoReturnMs?: number
  ) => void;
  setThinking: (thinking: boolean, statusNote?: string) => void;
  setActiveLocation: (roomId: string | null, roomCode?: string | null, roomName?: string | null) => void;
  startReadingSop: (sopId: string, sopTitle: string, assetId?: string | null, assetCode?: string) => void;
  stopReadingSop: (completionNote?: string) => void;
  toggleDoor: (openingId: string, doorLabel: string, roomId?: string | null) => boolean;
  setDoorOpen: (openingId: string, isOpen: boolean) => void;
  toggleRoomLight: (roomId: string, roomCode: string, roomName: string, switchId?: string, switchLabel?: string) => boolean;
  setSwitchState: (switchId: string, roomId: string, isOn: boolean, switchLabel?: string, roomCode?: string, roomName?: string) => void;
  isSwitchOn: (switchId: string, roomId: string, defaultOn?: boolean) => boolean;
  isRoomLightOn: (roomId: string) => boolean;
  logInteraction: (entry: Omit<MayaInteractionEntry, 'id' | 'timestamp'>) => void;

  // Workflow Event Log with Durations
  startWorkflowEvent: (entry: {
    kind: MayaInteractionKind;
    action: string;
    targetCode: string;
    targetName: string;
    toState: MayaStateName;
    roomId?: string | null;
    sopId?: string | null;
  }) => string;
  completeWorkflowEvent: (
    eventId: string,
    opts?: { status?: 'completed' | 'cancelled'; finalState?: MayaStateName; statusNote?: string }
  ) => void;
  clearWorkflowEvents: () => void;

  // Saved 3D Game Position & Restore
  saveWalkPose: (pose: Omit<SavedWalkPose, 'savedAt'>) => void;
  requestRestoreWalkPose: () => void;
  clearPendingRestoreWalkPose: () => void;

  // MAYA Life Chat Thread Actions
  addLifeMessage: (msg: Omit<MayaLifeMessage, 'id' | 'timestamp'>, threadId?: string) => MayaLifeMessage;
  createLifeThread: (initialTitle?: string) => string;
  selectLifeThread: (threadId: string) => void;
  deleteLifeThread: (threadId: string) => void;
  renameLifeThread: (threadId: string, title: string, titleGenerated?: boolean) => void;
  clearLifeChat: () => void;

  // MAYA Drawer Chat Thread Actions
  createDrawerThread: (initialTitle?: string) => string;
  selectDrawerThread: (threadId: string) => void;
  deleteDrawerThread: (threadId: string) => void;
  renameDrawerThread: (threadId: string, title: string, titleGenerated?: boolean) => void;
  appendDrawerMessage: (msg: MayaDrawerMessage, threadId?: string) => void;
  updateDrawerMessage: (
    messageId: string,
    updater: (msg: MayaDrawerMessage) => MayaDrawerMessage,
    threadId?: string
  ) => void;
  clearActiveDrawerThread: () => void;
}

const initial = loadMayaState();
const initialLifeThreads =
  initial.lifeThreads && initial.lifeThreads.length > 0
    ? initial.lifeThreads
    : [makeInitialLifeThread()];
const initialActiveLifeId =
  initial.activeLifeThreadId && initialLifeThreads.some((t) => t.id === initial.activeLifeThreadId)
    ? initial.activeLifeThreadId
    : initialLifeThreads[0].id;

const initialDrawerThreads =
  initial.drawerThreads && initial.drawerThreads.length > 0
    ? initial.drawerThreads
    : [makeInitialDrawerThread()];
const initialActiveDrawerId =
  initial.activeDrawerThreadId &&
  initialDrawerThreads.some((t) => t.id === initial.activeDrawerThreadId)
    ? initial.activeDrawerThreadId
    : initialDrawerThreads[0].id;

function persistFromState(s: MayaDomainState) {
  saveMayaState({
    interactions: s.interactions,
    workflowEvents: s.workflowEvents,
    lifeThreads: s.lifeThreads,
    activeLifeThreadId: s.activeLifeThreadId,
    drawerThreads: s.drawerThreads,
    activeDrawerThreadId: s.activeDrawerThreadId,
    roomLights: s.roomLights,
    switchStates: s.switchStates,
    openDoors: s.openDoors,
    savedWalkPose: s.savedWalkPose,
  });
}

export const useMayaStore = create<MayaDomainState>((set, get) => ({
  currentState: 'idle',
  currentExpression: 'neutral',
  statusNote: 'Monitoring facility rooms, equipment & SOPs',
  isThinking: false,
  isReadingSop: false,
  activeWorkflowId: null,
  activeRoomId: null,
  activeRoomCode: null,
  activeRoomName: null,
  activeAssetId: null,
  activeSopId: null,
  openDoors: initial.openDoors ?? {},
  roomLights: initial.roomLights ?? {},
  switchStates: initial.switchStates ?? {},
  interactions: initial.interactions ?? [],
  workflowEvents: (initial.workflowEvents ?? []).map((ev) =>
    ev.status === 'running'
      ? { ...ev, status: 'completed', endedAt: ev.endedAt ?? new Date().toISOString(), durationMs: ev.durationMs ?? 1200 }
      : ev
  ),
  savedWalkPose: initial.savedWalkPose ?? null,
  pendingRestoreWalkPose: false,

  lifeThreads: initialLifeThreads,
  activeLifeThreadId: initialActiveLifeId,
  lifeChatMessages:
    initialLifeThreads.find((t) => t.id === initialActiveLifeId)?.messages ?? [DEFAULT_LIFE_GREETING],

  drawerThreads: initialDrawerThreads,
  activeDrawerThreadId: initialActiveDrawerId,

  setMood: (currentState, currentExpression, statusNote, autoReturnMs) => {
    clearStateTimers();
    set((s) => ({
      currentState,
      currentExpression: currentExpression ?? s.currentExpression,
      statusNote: statusNote ?? s.statusNote,
    }));
    if (autoReturnMs && autoReturnMs > 0 && currentState !== 'idle') {
      stateResetTimer = setTimeout(() => {
        const cur = get();
        if (!cur.isThinking && !cur.isReadingSop) {
          set({
            currentState: 'idle',
            currentExpression: 'neutral',
            statusNote: 'Ready for next facility task',
          });
        }
      }, autoReturnMs);
    }
  },

  setThinking: (isThinking, statusNote) => {
    clearStateTimers();
    set((s) => ({
      isThinking,
      currentState: isThinking ? 'thinking' : 'approval',
      currentExpression: isThinking ? 'thinking' : 'confident',
      statusNote:
        statusNote ??
        (isThinking ? 'Analyzing facility telemetry & SOPs...' : 'Analysis complete — ready'),
    }));
    if (!isThinking) {
      stateResetTimer = setTimeout(() => {
        if (!get().isThinking) {
          set({
            currentState: 'idle',
            currentExpression: 'neutral',
            isReadingSop: false,
            statusNote: 'Monitoring facility rooms, equipment & SOPs',
          });
        }
      }, 2200);
    }
  },

  setActiveLocation: (activeRoomId, activeRoomCode = null, activeRoomName = null) => {
    const prev = get().activeRoomId;
    if (prev === activeRoomId) return;
    set({ activeRoomId, activeRoomCode, activeRoomName });
    if (activeRoomId && activeRoomCode) {
      const wfId = get().startWorkflowEvent({
        kind: 'room',
        action: 'Enter Room',
        targetCode: activeRoomCode,
        targetName: activeRoomName || activeRoomCode,
        toState: 'searching',
        roomId: activeRoomId,
      });
      get().logInteraction({
        kind: 'room',
        targetId: activeRoomId,
        targetCode: activeRoomCode,
        targetName: activeRoomName || activeRoomCode,
        summary: `Entered ${activeRoomCode} (${activeRoomName || 'Facility Room'})`,
        mayaState: 'searching',
        roomId: activeRoomId,
      });
      setTimeout(() => {
        get().completeWorkflowEvent(wfId, {
          finalState: 'idle',
          statusNote: `Inside ${activeRoomCode} · ${activeRoomName || 'Facility Room'}`,
        });
      }, 950);
    }
  },

  startReadingSop: (sopId, sopTitle, assetId = null, assetCode = 'SOP') => {
    clearStateTimers();
    if (sopFinishTimer) {
      clearTimeout(sopFinishTimer);
      sopFinishTimer = null;
    }
    // Complete any previous running SOP workflow event cleanly
    const prevWf = get().activeWorkflowId;
    if (prevWf) {
      get().completeWorkflowEvent(prevWf, { status: 'completed' });
    }
    const wfId = get().startWorkflowEvent({
      kind: 'sop',
      action: 'Read & Review SOP',
      targetCode: assetCode,
      targetName: sopTitle,
      toState: 'analyze',
      sopId,
    });
    set({
      activeSopId: sopId,
      activeAssetId: assetId,
      activeWorkflowId: wfId,
      isReadingSop: true,
      currentState: 'analyze',
      currentExpression: 'curious',
      statusNote: `Reading SOP: ${sopTitle}`,
    });
    get().logInteraction({
      kind: 'sop',
      targetId: sopId,
      targetCode: assetCode,
      targetName: sopTitle,
      summary: `Studied & reviewed ${sopTitle}`,
      mayaState: 'analyze',
      sopId,
    });
    // Automatically transition from analyze -> approval -> idle once initial review completes
    // so MAYA never gets stuck on 'analyze' indefinitely!
    sopFinishTimer = setTimeout(() => {
      const cur = get();
      if (cur.activeWorkflowId === wfId && !cur.isThinking) {
        cur.stopReadingSop(`Finished reviewing ${sopTitle}`);
      }
    }, 5200);
  },

  stopReadingSop: (completionNote) => {
    clearStateTimers();
    if (sopFinishTimer) {
      clearTimeout(sopFinishTimer);
      sopFinishTimer = null;
    }
    const wfId = get().activeWorkflowId;
    if (wfId) {
      get().completeWorkflowEvent(wfId, {
        status: 'completed',
        finalState: 'approval',
        statusNote: completionNote || 'Completed SOP review',
      });
    }
    set({
      isReadingSop: false,
      activeWorkflowId: null,
      currentState: 'approval',
      currentExpression: 'happy',
      statusNote: completionNote || 'SOP review complete — ready for next inspection',
    });
    stateResetTimer = setTimeout(() => {
      const cur = get();
      if (!cur.isThinking && !cur.isReadingSop) {
        set({
          currentState: 'idle',
          currentExpression: 'neutral',
          statusNote: 'Ready for next inspection',
        });
      }
    }, 2000);
  },

  toggleDoor: (openingId, doorLabel, roomId = null) => {
    const nextOpen = !Boolean(get().openDoors[openingId]);
    const nextDoors = { ...get().openDoors, [openingId]: nextOpen };
    const wfId = get().startWorkflowEvent({
      kind: 'door',
      action: nextOpen ? 'Open Door' : 'Close Door',
      targetCode: nextOpen ? 'DOOR-OPEN' : 'DOOR-SHUT',
      targetName: doorLabel,
      toState: 'working',
      roomId,
    });
    set({
      openDoors: nextDoors,
      currentState: 'working',
      currentExpression: 'approval',
      statusNote: `${nextOpen ? 'Opened' : 'Closed'} ${doorLabel}`,
    });
    get().logInteraction({
      kind: 'door',
      targetId: openingId,
      targetCode: nextOpen ? 'DOOR-OPEN' : 'DOOR-SHUT',
      targetName: doorLabel,
      summary: `${nextOpen ? 'Opened' : 'Closed'} ${doorLabel}`,
      mayaState: 'working',
      roomId,
    });
    persistFromState(get());
    setTimeout(() => {
      get().completeWorkflowEvent(wfId, {
        finalState: 'idle',
        statusNote: `${doorLabel} is now ${nextOpen ? 'open' : 'closed'}`,
      });
    }, 1100);
    return nextOpen;
  },

  setDoorOpen: (openingId, isOpen) =>
    set((s) => ({ openDoors: { ...s.openDoors, [openingId]: isOpen } })),

  toggleRoomLight: (roomId, roomCode, roomName, switchId, switchLabel) => {
    const st = get();
    const cur = switchId
      ? st.switchStates[switchId] ?? st.roomLights[roomId] ?? true
      : st.roomLights[roomId] ?? true;
    const nextOn = !cur;
    const nextLights = { ...st.roomLights, [roomId]: nextOn };
    const nextSwitchStates = switchId
      ? { ...st.switchStates, [switchId]: nextOn }
      : { ...st.switchStates, [`sw-${roomId}-main`]: nextOn };
    const label = switchLabel || `${roomName} Lighting`;
    const wfId = st.startWorkflowEvent({
      kind: 'light',
      action: nextOn ? 'Turn Light ON' : 'Turn Light OFF',
      targetCode: roomCode,
      targetName: label,
      toState: 'approval',
      roomId,
    });
    set({
      roomLights: nextLights,
      switchStates: nextSwitchStates,
      currentState: 'approval',
      currentExpression: nextOn ? 'happy' : 'neutral',
      statusNote: `Switched ${roomCode} (${label}) ${nextOn ? 'ON' : 'OFF'}`,
    });
    get().logInteraction({
      kind: 'light',
      targetId: switchId || roomId,
      targetCode: roomCode,
      targetName: label,
      summary: `Turned ${roomCode} lighting (${label}) ${nextOn ? 'ON' : 'OFF'}`,
      mayaState: 'approval',
      roomId,
    });
    persistFromState(get());
    setTimeout(() => {
      get().completeWorkflowEvent(wfId, {
        finalState: 'idle',
        statusNote: `${roomCode} lighting is ${nextOn ? 'ON' : 'OFF'}`,
      });
    }, 900);
    return nextOn;
  },

  setSwitchState: (switchId, roomId, isOn, switchLabel, roomCode = 'ROOM', roomName = 'Room') => {
    const st = get();
    const nextSwitchStates = { ...st.switchStates, [switchId]: isOn };
    const nextLights = { ...st.roomLights, [roomId]: isOn };
    set({
      switchStates: nextSwitchStates,
      roomLights: nextLights,
      currentState: 'approval',
      currentExpression: isOn ? 'happy' : 'neutral',
      statusNote: `${switchLabel || roomCode} switched ${isOn ? 'ON' : 'OFF'}`,
    });
    const wfId = get().startWorkflowEvent({
      kind: 'light',
      action: isOn ? 'Switch Circuit ON' : 'Switch Circuit OFF',
      targetCode: roomCode,
      targetName: switchLabel || roomName,
      toState: 'approval',
      roomId,
    });
    persistFromState(get());
    setTimeout(() => {
      get().completeWorkflowEvent(wfId, { finalState: 'idle' });
    }, 800);
  },

  isSwitchOn: (switchId, roomId, defaultOn = true) => {
    const st = get();
    if (st.switchStates[switchId] !== undefined) return st.switchStates[switchId];
    if (st.roomLights[roomId] !== undefined) return st.roomLights[roomId];
    return defaultOn;
  },

  isRoomLightOn: (roomId) => get().roomLights[roomId] ?? true,

  logInteraction: (entry) => {
    const now = new Date().toISOString();
    set((s) => {
      const head = s.interactions[0];
      if (
        head &&
        head.kind === entry.kind &&
        head.targetId === entry.targetId &&
        head.summary === entry.summary &&
        Date.now() - new Date(head.timestamp).getTime() < 10000
      ) {
        return s;
      }
      const next: MayaInteractionEntry[] = [
        {
          ...entry,
          id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
        },
        ...s.interactions,
      ].slice(0, 100);
      const updated = { ...s, interactions: next };
      persistFromState(updated);
      return { interactions: next };
    });
  },

  startWorkflowEvent: (entry) => {
    const id = `mwf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const fromState = get().currentState;
    const ev: MayaWorkflowEvent = {
      id,
      startedAt: now,
      kind: entry.kind,
      action: entry.action,
      targetCode: entry.targetCode,
      targetName: entry.targetName,
      fromState,
      toState: entry.toState,
      status: 'running',
      roomId: entry.roomId ?? null,
      sopId: entry.sopId ?? null,
    };
    set((s) => {
      const next = [ev, ...s.workflowEvents].slice(0, 120);
      const updated = { ...s, workflowEvents: next };
      persistFromState(updated);
      return { workflowEvents: next };
    });
    return id;
  },

  completeWorkflowEvent: (eventId, opts) => {
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    set((s) => {
      let found = false;
      const next = s.workflowEvents.map((ev) => {
        if (ev.id !== eventId || ev.status !== 'running') return ev;
        found = true;
        const durationMs = Math.max(80, nowMs - new Date(ev.startedAt).getTime());
        return {
          ...ev,
          status: opts?.status ?? 'completed',
          endedAt: nowIso,
          durationMs,
        };
      });
      if (!found) return s;
      const nextStatePatch: Partial<MayaDomainState> = { workflowEvents: next };
      if (opts?.finalState && !s.isThinking && !s.isReadingSop) {
        nextStatePatch.currentState = opts.finalState;
        if (opts.finalState === 'idle') nextStatePatch.currentExpression = 'neutral';
      }
      if (opts?.statusNote) {
        nextStatePatch.statusNote = opts.statusNote;
      }
      const updated = { ...s, ...nextStatePatch };
      persistFromState(updated);
      return nextStatePatch;
    });
  },

  clearWorkflowEvents: () => {
    set((s) => {
      const updated = { ...s, workflowEvents: [] };
      persistFromState(updated);
      return { workflowEvents: [] };
    });
  },

  saveWalkPose: (pose) => {
    const full: SavedWalkPose = { ...pose, savedAt: new Date().toISOString() };
    set((s) => {
      const updated = { ...s, savedWalkPose: full };
      persistFromState(updated);
      return { savedWalkPose: full };
    });
  },

  requestRestoreWalkPose: () => set({ pendingRestoreWalkPose: true }),

  clearPendingRestoreWalkPose: () => set({ pendingRestoreWalkPose: false }),

  // MAYA Life Multi-Thread Chat
  addLifeMessage: (msg, threadId) => {
    const full: MayaLifeMessage = {
      ...msg,
      id: `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    set((s) => {
      const targetId = threadId || s.activeLifeThreadId;
      const nextThreads = s.lifeThreads.map((t) =>
        t.id === targetId
          ? { ...t, updatedAt: full.timestamp, messages: [...t.messages, full].slice(-50) }
          : t
      );
      const activeMsgs =
        nextThreads.find((t) => t.id === s.activeLifeThreadId)?.messages ?? s.lifeChatMessages;
      const updated = { ...s, lifeThreads: nextThreads, lifeChatMessages: activeMsgs };
      persistFromState(updated);
      return { lifeThreads: nextThreads, lifeChatMessages: activeMsgs };
    });
    return full;
  },

  createLifeThread: (initialTitle) => {
    const now = new Date().toISOString();
    const id = `mlt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const thread: MayaLifeThread = {
      id,
      title: initialTitle || 'New MAYA Session',
      titleGenerated: false,
      createdAt: now,
      updatedAt: now,
      messages: [{ ...DEFAULT_LIFE_GREETING, id: `ml-welcome-${Date.now()}`, timestamp: now }],
    };
    set((s) => {
      const nextThreads = [thread, ...s.lifeThreads].slice(0, 30);
      const updated = {
        ...s,
        lifeThreads: nextThreads,
        activeLifeThreadId: id,
        lifeChatMessages: thread.messages,
      };
      persistFromState(updated);
      return {
        lifeThreads: nextThreads,
        activeLifeThreadId: id,
        lifeChatMessages: thread.messages,
      };
    });
    return id;
  },

  selectLifeThread: (threadId) => {
    set((s) => {
      const found = s.lifeThreads.find((t) => t.id === threadId);
      if (!found) return s;
      const updated = {
        ...s,
        activeLifeThreadId: threadId,
        lifeChatMessages: found.messages,
      };
      persistFromState(updated);
      return {
        activeLifeThreadId: threadId,
        lifeChatMessages: found.messages,
      };
    });
  },

  deleteLifeThread: (threadId) => {
    set((s) => {
      const remaining = s.lifeThreads.filter((t) => t.id !== threadId);
      const nextThreads = remaining.length > 0 ? remaining : [makeInitialLifeThread()];
      const nextActiveId =
        s.activeLifeThreadId === threadId ? nextThreads[0].id : s.activeLifeThreadId;
      const nextMsgs =
        nextThreads.find((t) => t.id === nextActiveId)?.messages ?? nextThreads[0].messages;
      const updated = {
        ...s,
        lifeThreads: nextThreads,
        activeLifeThreadId: nextActiveId,
        lifeChatMessages: nextMsgs,
      };
      persistFromState(updated);
      return {
        lifeThreads: nextThreads,
        activeLifeThreadId: nextActiveId,
        lifeChatMessages: nextMsgs,
      };
    });
  },

  renameLifeThread: (threadId, title, titleGenerated = true) => {
    const clean = title.trim().slice(0, 64);
    if (!clean) return;
    set((s) => {
      const nextThreads = s.lifeThreads.map((t) =>
        t.id === threadId ? { ...t, title: clean, titleGenerated } : t
      );
      const updated = { ...s, lifeThreads: nextThreads };
      persistFromState(updated);
      return { lifeThreads: nextThreads };
    });
  },

  clearLifeChat: () => {
    const now = new Date().toISOString();
    const reset = [{ ...DEFAULT_LIFE_GREETING, id: `ml-welcome-${Date.now()}`, timestamp: now }];
    set((s) => {
      const nextThreads = s.lifeThreads.map((t) =>
        t.id === s.activeLifeThreadId ? { ...t, updatedAt: now, messages: reset } : t
      );
      const updated = { ...s, lifeThreads: nextThreads, lifeChatMessages: reset };
      persistFromState(updated);
      return { lifeThreads: nextThreads, lifeChatMessages: reset };
    });
  },

  // MAYA Drawer Multi-Thread Chat
  createDrawerThread: (initialTitle) => {
    const now = new Date().toISOString();
    const id = `mdt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const thread: MayaDrawerThread = {
      id,
      title: initialTitle || 'New MAYA Consultation',
      titleGenerated: false,
      createdAt: now,
      updatedAt: now,
      messages: [{ ...DEFAULT_DRAWER_GREETING, id: `maya-welcome-${Date.now()}` }],
    };
    set((s) => {
      const nextThreads = [thread, ...s.drawerThreads].slice(0, 30);
      const updated = { ...s, drawerThreads: nextThreads, activeDrawerThreadId: id };
      persistFromState(updated);
      return { drawerThreads: nextThreads, activeDrawerThreadId: id };
    });
    return id;
  },

  selectDrawerThread: (threadId) => {
    set((s) => {
      if (!s.drawerThreads.some((t) => t.id === threadId)) return s;
      const updated = { ...s, activeDrawerThreadId: threadId };
      persistFromState(updated);
      return { activeDrawerThreadId: threadId };
    });
  },

  deleteDrawerThread: (threadId) => {
    set((s) => {
      const remaining = s.drawerThreads.filter((t) => t.id !== threadId);
      const nextThreads = remaining.length > 0 ? remaining : [makeInitialDrawerThread()];
      const nextActiveId =
        s.activeDrawerThreadId === threadId ? nextThreads[0].id : s.activeDrawerThreadId;
      const updated = { ...s, drawerThreads: nextThreads, activeDrawerThreadId: nextActiveId };
      persistFromState(updated);
      return { drawerThreads: nextThreads, activeDrawerThreadId: nextActiveId };
    });
  },

  renameDrawerThread: (threadId, title, titleGenerated = true) => {
    const clean = title.trim().slice(0, 64);
    if (!clean) return;
    set((s) => {
      const nextThreads = s.drawerThreads.map((t) =>
        t.id === threadId ? { ...t, title: clean, titleGenerated } : t
      );
      const updated = { ...s, drawerThreads: nextThreads };
      persistFromState(updated);
      return { drawerThreads: nextThreads };
    });
  },

  appendDrawerMessage: (msg, threadId) => {
    const now = new Date().toISOString();
    set((s) => {
      const targetId = threadId || s.activeDrawerThreadId;
      const nextThreads = s.drawerThreads.map((t) =>
        t.id === targetId
          ? { ...t, updatedAt: now, messages: [...t.messages, msg].slice(-60) }
          : t
      );
      const updated = { ...s, drawerThreads: nextThreads };
      persistFromState(updated);
      return { drawerThreads: nextThreads };
    });
  },

  updateDrawerMessage: (messageId, updater, threadId) => {
    set((s) => {
      const targetId = threadId || s.activeDrawerThreadId;
      const nextThreads = s.drawerThreads.map((t) =>
        t.id === targetId
          ? {
              ...t,
              messages: t.messages.map((m) => (m.id === messageId ? updater(m) : m)),
            }
          : t
      );
      const updated = { ...s, drawerThreads: nextThreads };
      persistFromState(updated);
      return { drawerThreads: nextThreads };
    });
  },

  clearActiveDrawerThread: () => {
    const now = new Date().toISOString();
    set((s) => {
      const nextThreads = s.drawerThreads.map((t) =>
        t.id === s.activeDrawerThreadId
          ? {
              ...t,
              updatedAt: now,
              messages: [{ ...DEFAULT_DRAWER_GREETING, id: `maya-welcome-${Date.now()}` }],
            }
          : t
      );
      const updated = { ...s, drawerThreads: nextThreads };
      persistFromState(updated);
      return { drawerThreads: nextThreads };
    });
  },
}));
