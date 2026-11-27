import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Flame,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  Radio,
  Sparkles,
  Volume2,
  Wind,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useMayaStore } from '../store/useMayaStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { fetchApiJson } from '../utils/safeJson';
import { getEffectiveRoomHvac } from '../utils/hvac';

const SAMPLE_VOICE_COMMANDS = [
  'Maya, show me the fire sensors in the Fermentation room',
  'Maya, highlight all HVAC equipment with high energy usage',
  'Maya, turn off lights in Upstream Cell Culture',
  'Maya, walk me to the Chromatography room',
];

interface VoiceCommandResult {
  action:
    | 'show_fire_sensors'
    | 'highlight_hvac_energy'
    | 'highlight_assets'
    | 'navigate_room'
    | 'walk_room'
    | 'toggle_room_light'
    | 'open_equipment_info'
    | 'open_screen'
    | 'ask_maya';
  roomId?: string;
  assetId?: string;
  matchedAssetIds?: string[];
  matchedRoomIds?: string[];
  desiredBool?: boolean;
  enableHvacOverlay?: boolean;
  screen?: string;
  bannerTitle?: string;
  bannerSubtitle?: string;
  spokenFeedback: string;
  chatPrompt?: string;
}

/**
 * Global microphone voice command listener ("Maya, ...") mounted in TopToolbar.
 * Uses browser Web Speech API with automatic Gemini transcription fallback (/api/maya/transcribe)
 * and structured Gemini intent routing (/api/maya/voice-command).
 */
export const GlobalVoiceCommandListener: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopAllAudioCapture = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    try {
      if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
        mediaRecRef.current.stop();
      }
    } catch {
      // ignore
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => {
    return () => stopAllAudioCapture();
  }, [stopAllAudioCapture]);

  const findRoomByText = (query: string) => {
    const q = query.toLowerCase();
    const rooms = useTwinStore.getState().scene.rooms;
    return (
      rooms.find((r) => q.includes(r.code.toLowerCase())) ||
      rooms.find((r) => q.includes(r.name.toLowerCase())) ||
      rooms.find((r) => {
        const tokens = r.name
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 4);
        return tokens.some((tok) => q.includes(tok));
      }) ||
      // Alias matching: "fermentation" -> Upstream Cell Culture / Bioreactor suite
      (q.includes('ferment')
        ? rooms.find((r) =>
            `${r.name} ${r.category} ${r.code}`
              .toLowerCase()
              .match(/ferment|upstream|bioreactor|cell culture/)
          )
        : undefined) ||
      (q.includes('cold')
        ? rooms.find((r) => `${r.name} ${r.category}`.toLowerCase().includes('cold'))
        : undefined)
    );
  };

  const executeVoiceResult = useCallback((cmd: VoiceCommandResult, rawTranscript: string) => {
    const twin = useTwinStore.getState();
    const maya = useMayaStore.getState();

    const finishMsg = (msg: string) => {
      setFeedback(msg);
      twin.showToast(msg, 'info');
      maya.setMood('approval', 'happy', msg, 2400);
    };

    if (cmd.action === 'show_fire_sensors') {
      const rm =
        twin.scene.rooms.find((r) => r.id === cmd.roomId) ||
        findRoomByText(rawTranscript) ||
        twin.scene.rooms[0];
      if (rm) {
        twin.setScreen('workspace');
        twin.setActiveFloor(rm.floorId);
        twin.focusEntity({ type: 'room', id: rm.id });
        twin.setVoiceHighlight([rm.id], {
          title: `Fire Safety · ${rm.code} ${rm.name}`,
          subtitle: `Showing fire sensors & extinguishers in ${rm.name}`,
          kind: 'room',
        });
        twin.openEntityInfo({ type: 'room', id: rm.id }, { initialTab: 'fire' });
        finishMsg(cmd.spokenFeedback || `Opened fire sensors & safety inventory for ${rm.code} ${rm.name}.`);
        return;
      }
    }

    if (cmd.action === 'highlight_hvac_energy') {
      twin.setScreen('workspace');
      twin.setShowHvacOverlay(true);
      if (twin.viewMode === '2d') twin.setViewMode('3d-perspective');
      let ids = (cmd.matchedAssetIds ?? []).filter((id) =>
        twin.scene.assets.some((a) => a.id === id)
      );
      if (ids.length === 0) {
        const hvacCandidates = twin.scene.assets
          .filter(
            (a) =>
              a.category === 'HVAC & Utilities' ||
              ['ahu-unit', 'chiller', 'crac-cooling', 'cold-room-unit'].includes(a.archetype) ||
              a.energyKw >= 12
          )
          .sort((a, b) => b.energyKw - a.energyKw);
        ids = hvacCandidates.slice(0, 8).map((a) => a.id);
      }
      if (ids.length > 0) {
        const firstAsset = twin.scene.assets.find((a) => a.id === ids[0]);
        if (firstAsset) {
          twin.setActiveFloor(firstAsset.floorId);
          twin.focusEntity({ type: 'asset', id: firstAsset.id });
        }
        twin.setVoiceHighlight(ids, {
          title: cmd.bannerTitle || 'High-Energy HVAC & Utility Equipment',
          subtitle:
            cmd.bannerSubtitle ||
            `Highlighted ${ids.length} high-load HVAC/utility assets with 3D airflow overlay enabled`,
          kind: 'asset',
        });
      }
      finishMsg(
        cmd.spokenFeedback ||
          `Highlighted ${ids.length} high-energy HVAC units and enabled 3D HVAC overlay.`
      );
      return;
    }

    if (cmd.action === 'highlight_assets') {
      twin.setScreen('workspace');
      const ids = (cmd.matchedAssetIds ?? []).filter((id) =>
        twin.scene.assets.some((a) => a.id === id)
      );
      if (ids.length > 0) {
        const first = twin.scene.assets.find((a) => a.id === ids[0]);
        if (first) {
          twin.setActiveFloor(first.floorId);
          twin.focusEntity({ type: 'asset', id: first.id });
        }
        twin.setVoiceHighlight(ids, {
          title: cmd.bannerTitle || 'Voice-Matched Equipment',
          subtitle: cmd.bannerSubtitle || `${ids.length} matching asset(s) highlighted in 3D`,
          kind: 'asset',
        });
      }
      finishMsg(cmd.spokenFeedback || `Highlighted ${ids.length} equipment item(s).`);
      return;
    }

    if (cmd.action === 'toggle_room_light') {
      const rm =
        twin.scene.rooms.find((r) => r.id === cmd.roomId) ||
        findRoomByText(rawTranscript) ||
        twin.scene.rooms[0];
      if (rm) {
        const desired = cmd.desiredBool ?? !(maya.roomLights[rm.id] ?? true);
        const switches = rm.lighting?.switches ?? [{ id: `sw-${rm.id}-main`, label: `${rm.code} Lighting` }];
        switches.forEach((sw) => {
          maya.setSwitchState(sw.id, rm.id, desired, sw.label, rm.code, rm.name);
        });
        twin.setScreen('workspace');
        twin.setActiveFloor(rm.floorId);
        twin.focusEntity({ type: 'room', id: rm.id });
        finishMsg(cmd.spokenFeedback || `Turned ${rm.code} ${rm.name} lighting ${desired ? 'ON' : 'OFF'}.`);
        return;
      }
    }

    if (cmd.action === 'walk_room') {
      const rm =
        twin.scene.rooms.find((r) => r.id === cmd.roomId) || findRoomByText(rawTranscript);
      if (rm) {
        twin.setScreen('workspace');
        twin.walkInsideRoom(rm.id);
        finishMsg(cmd.spokenFeedback || `Walking MAYA inside ${rm.code} ${rm.name}.`);
        return;
      }
    }

    if (cmd.action === 'navigate_room') {
      const rm =
        twin.scene.rooms.find((r) => r.id === cmd.roomId) || findRoomByText(rawTranscript);
      if (rm) {
        twin.setScreen('workspace');
        twin.setActiveFloor(rm.floorId);
        twin.focusEntity({ type: 'room', id: rm.id });
        twin.setVoiceHighlight([rm.id], {
          title: `${rm.code} · ${rm.name}`,
          subtitle: `${rm.environmental.cleanroomGrade} · ${rm.energyKw} kW`,
          kind: 'room',
        });
        finishMsg(cmd.spokenFeedback || `Focused ${rm.code} ${rm.name}.`);
        return;
      }
    }

    if (cmd.action === 'open_equipment_info') {
      const ast = twin.scene.assets.find((a) => a.id === cmd.assetId);
      if (ast) {
        twin.setScreen('workspace');
        twin.setActiveFloor(ast.floorId);
        twin.focusEntity({ type: 'asset', id: ast.id });
        twin.openEntityInfo({ type: 'asset', id: ast.id });
        finishMsg(cmd.spokenFeedback || `Opened equipment dossier for ${ast.assetId}.`);
        return;
      }
    }

    if (cmd.action === 'open_screen' && cmd.screen) {
      if (cmd.screen === 'telemetry') {
        useTelemetryStore.getState().openDashboard({ tab: 'overview' });
      } else if (['workspace', 'maya-life', 'data-center', 'projects'].includes(cmd.screen)) {
        twin.setScreen(cmd.screen as any);
      }
      finishMsg(cmd.spokenFeedback || `Switched view to ${cmd.screen}.`);
      return;
    }

    // Fallback: open MAYA Chat drawer with the spoken query
    twin.setShowMayaChat(true);
    finishMsg(cmd.spokenFeedback || `Routed "${rawTranscript}" to MAYA AI Chat.`);
  }, []);

  const runVoiceTranscript = useCallback(
    async (spokenText: string) => {
      const cleaned = spokenText.trim();
      if (!cleaned) return;
      setTranscript(cleaned);
      setProcessing(true);
      setErrorMsg(null);

      const maya = useMayaStore.getState();
      const wfId = maya.startWorkflowEvent({
        kind: 'voice',
        action: 'Voice Command',
        targetCode: 'VOICE',
        targetName: cleaned.slice(0, 48),
        toState: 'thinking',
      });
      maya.setMood('thinking', 'curious', `Processing voice: "${cleaned}"`);

      try {
        const twin = useTwinStore.getState();
        const context = {
          rooms: twin.scene.rooms.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            energyKw: r.energyKw,
            hvacStatus: getEffectiveRoomHvac(r).status,
          })),
          assets: twin.scene.assets.map((a) => ({
            id: a.id,
            code: a.assetId,
            name: a.name,
            category: a.category,
            archetype: a.archetype,
            roomId: a.roomId ?? '',
            energyKw: a.energyKw,
          })),
        };

        const res = await fetchApiJson<VoiceCommandResult>('/api/maya/voice-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: cleaned, context }),
        });

        executeVoiceResult(res, cleaned);
        maya.completeWorkflowEvent(wfId, {
          status: 'completed',
          finalState: 'idle',
          statusNote: res.spokenFeedback,
        });
      } catch (err: any) {
        // Deterministic local fallback if offline or API rate-limited
        const lower = cleaned.toLowerCase();
        if (lower.includes('fire') && (lower.includes('sensor') || lower.includes('extinguish'))) {
          const rm = findRoomByText(cleaned);
          executeVoiceResult(
            {
              action: 'show_fire_sensors',
              roomId: rm?.id,
              spokenFeedback: rm
                ? `Showing fire sensors & extinguishers in ${rm.code} ${rm.name}.`
                : 'Opened fire safety sensor inventory.',
            },
            cleaned
          );
          maya.completeWorkflowEvent(wfId, { status: 'completed', finalState: 'idle' });
        } else if (lower.includes('hvac') && (lower.includes('energy') || lower.includes('high') || lower.includes('highlight'))) {
          executeVoiceResult(
            {
              action: 'highlight_hvac_energy',
              enableHvacOverlay: true,
              spokenFeedback: 'Highlighted high-energy HVAC equipment with 3D airflow overlay.',
            },
            cleaned
          );
          maya.completeWorkflowEvent(wfId, { status: 'completed', finalState: 'idle' });
        } else if (lower.includes('light') && (lower.includes('off') || lower.includes('on'))) {
          const rm = findRoomByText(cleaned);
          executeVoiceResult(
            {
              action: 'toggle_room_light',
              roomId: rm?.id,
              desiredBool: !lower.includes('off'),
              spokenFeedback: rm
                ? `Switched ${rm.code} lighting ${lower.includes('off') ? 'OFF' : 'ON'}.`
                : 'Updated room lighting.',
            },
            cleaned
          );
          maya.completeWorkflowEvent(wfId, { status: 'completed', finalState: 'idle' });
        } else if (lower.includes('walk')) {
          const rm = findRoomByText(cleaned);
          executeVoiceResult(
            {
              action: 'walk_room',
              roomId: rm?.id,
              spokenFeedback: rm ? `Walking inside ${rm.code} ${rm.name}.` : 'Starting walkthrough.',
            },
            cleaned
          );
          maya.completeWorkflowEvent(wfId, { status: 'completed', finalState: 'idle' });
        } else {
          setErrorMsg(err?.message || 'Could not interpret voice command.');
          maya.completeWorkflowEvent(wfId, { status: 'cancelled', finalState: 'idle' });
        }
      } finally {
        setProcessing(false);
      }
    },
    [executeVoiceResult]
  );

  const startListening = useCallback(async () => {
    setOpen(true);
    setErrorMsg(null);
    setFeedback(null);
    setTranscript('');

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRec) {
      try {
        const rec = new SpeechRec();
        rec.lang = 'en-US';
        rec.interimResults = true;
        rec.continuous = false;
        recognitionRef.current = rec;
        let finalText = '';

        rec.onstart = () => setListening(true);
        rec.onresult = (event: any) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const txt = event.results[i][0]?.transcript ?? '';
            if (event.results[i].isFinal) {
              finalText += txt;
            } else {
              interim += txt;
            }
          }
          setTranscript((finalText || interim).trim());
        };
        rec.onerror = (ev: any) => {
          setListening(false);
          if (ev.error === 'not-allowed') {
            setErrorMsg('Microphone permission denied. Allow microphone access or pick a command below.');
          } else if (ev.error !== 'aborted') {
            setErrorMsg(`Voice capture error: ${ev.error}. Try speaking again or click a preset.`);
          }
        };
        rec.onend = () => {
          setListening(false);
          if (finalText.trim()) {
            void runVoiceTranscript(finalText.trim());
          }
        };
        rec.start();
        return;
      } catch {
        // Fall through to MediaRecorder + Gemini transcribe
      }
    }

    // Fallback: record audio clip and transcribe with /api/maya/transcribe
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 400) return;
        setProcessing(true);
        try {
          const reader = new FileReader();
          const b64: string = await new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const tr = await fetchApiJson<{ text: string }>('/api/maya/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioBase64: b64, mimeType: blob.type }),
          });
          if (tr.text?.trim()) {
            await runVoiceTranscript(tr.text.trim());
          } else {
            setErrorMsg('No speech detected. Try speaking clearly.');
          }
        } catch (err: any) {
          setErrorMsg(err?.message || 'Voice transcription failed.');
        } finally {
          setProcessing(false);
        }
      };
      mr.start();
      setListening(true);
    } catch {
      setErrorMsg('Microphone unavailable. Type or select a Maya voice command below.');
    }
  }, [runVoiceTranscript]);

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => {
          if (listening) {
            stopAllAudioCapture();
          } else if (open) {
            startListening();
          } else {
            startListening();
          }
        }}
        className={`relative p-1.5 rounded-lg border transition-colors cursor-pointer ${
          listening
            ? 'bg-rose-600 border-rose-400 text-white shadow-[0_0_16px_rgba(244,63,94,0.55)]'
            : processing
              ? 'bg-violet-600 border-violet-400 text-white'
              : open
                ? 'bg-violet-600/15 border-violet-500/50 text-violet-400'
                : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
        }`}
        title='Global Voice Command ("Maya, ...")'
        aria-label="Global Voice Command"
      >
        {processing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : listening ? (
          <Radio className="w-4 h-4 animate-pulse" />
        ) : (
          <Mic className="w-4 h-4" />
        )}
        {listening && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-300 animate-ping" />
        )}
      </button>

      {/* Floating Voice Command HUD Panel */}
      {open && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[90] w-[min(94vw,470px)] rounded-2xl bg-[#11121A] border border-violet-500/45 shadow-[0_20px_60px_rgba(0,0,0,0.75)] text-zinc-100 overflow-hidden">
          <div className="px-3.5 py-2.5 bg-[#171824] border-b border-zinc-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2 h-2 rounded-full ${
                  listening
                    ? 'bg-rose-500 animate-ping'
                    : processing
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-emerald-400'
                }`}
              />
              <span className="text-xs font-bold text-white truncate">
                MAYA Global Voice Command
              </span>
              <span className="text-[10px] font-mono text-zinc-400">
                {listening ? 'Listening...' : processing ? 'Routing...' : 'Standby'}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => (listening ? stopAllAudioCapture() : startListening())}
                className={`px-2 py-1 rounded-lg text-[10.5px] font-semibold flex items-center gap-1 cursor-pointer transition ${
                  listening
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}
              >
                {listening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                {listening ? 'Stop' : 'Speak'}
              </button>
              <button
                type="button"
                onClick={() => {
                  stopAllAudioCapture();
                  setOpen(false);
                }}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                title="Close Voice HUD"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-3 space-y-2.5">
            {/* Manual / Spoken Command Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (transcript.trim() && !processing) {
                  void runVoiceTranscript(transcript);
                }
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder='Say or type "Maya, show me the fire sensors in the Fermentation room"...'
                className="flex-1 px-3 py-1.5 rounded-xl bg-[#1A1B27] border border-zinc-700/80 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400"
              />
              <button
                type="submit"
                disabled={processing || !transcript.trim()}
                className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
              >
                Run
              </button>
            </form>

            {feedback && (
              <div className="px-2.5 py-2 rounded-xl bg-emerald-500/12 border border-emerald-500/35 text-[11px] text-emerald-200 flex items-start gap-2">
                <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>{feedback}</span>
              </div>
            )}

            {errorMsg && (
              <div className="px-2.5 py-2 rounded-xl bg-rose-500/12 border border-rose-500/35 text-[11px] text-rose-200">
                {errorMsg}
              </div>
            )}

            {/* Quick Voice Command Presets */}
            <div className="space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                Quick Voice Phrases
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {SAMPLE_VOICE_COMMANDS.map((phrase, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={processing}
                    onClick={() => void runVoiceTranscript(phrase)}
                    className="text-left px-2.5 py-1.5 rounded-xl bg-[#181925] hover:bg-[#222336] border border-zinc-800 hover:border-violet-500/50 text-[10.5px] text-zinc-200 transition flex items-start gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {idx === 0 ? (
                      <Flame className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
                    ) : idx === 1 ? (
                      <Wind className="w-3 h-3 text-sky-400 shrink-0 mt-0.5" />
                    ) : idx === 2 ? (
                      <Lightbulb className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <Sparkles className="w-3 h-3 text-violet-400 shrink-0 mt-0.5" />
                    )}
                    <span className="leading-snug">{phrase}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
