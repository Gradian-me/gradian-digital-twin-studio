import React from 'react';
import { CheckCircle2, Circle, Compass, X } from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';

interface StepItem {
  id: number;
  title: string;
  actionLabel: string;
  run: () => void;
}

export const OnboardingChecklist: React.FC = () => {
  const showOnboarding = useTwinStore((s) => s.showOnboarding);
  const setShowOnboarding = useTwinStore((s) => s.setShowOnboarding);
  const completedSteps = useTwinStore((s) => s.completedOnboardingSteps);
  const completeStep = useTwinStore((s) => s.completeOnboardingStep);
  const addBuilding = useTwinStore((s) => s.addBuilding);
  const addFloor = useTwinStore((s) => s.addFloor);
  const activeBuildingId = useTwinStore((s) => s.activeBuildingId);
  const setViewMode = useTwinStore((s) => s.setViewMode);
  const setActiveTool = useTwinStore((s) => s.setActiveTool);
  const setLeftTab = useTwinStore((s) => s.setLeftTab);
  const setRightTab = useTwinStore((s) => s.setRightTab);
  const setShowXRModal = useTwinStore((s) => s.setShowXRModal);

  if (!showOnboarding) return null;

  const steps: StepItem[] = [
    {
      id: 1,
      title: 'Initialize blank site workspace',
      actionLabel: 'Done',
      run: () => completeStep(1),
    },
    {
      id: 2,
      title: 'Add a building structure',
      actionLabel: 'Add Building',
      run: () => {
        addBuilding('Production Annex');
        completeStep(2);
      },
    },
    {
      id: 3,
      title: 'Add a second facility floor',
      actionLabel: 'Add Floor',
      run: () => {
        addFloor({
          buildingId: activeBuildingId,
          name: 'Level 1 · Cleanroom Suite',
          height: 3.8,
          width: 30,
          depth: 20,
        });
        completeStep(3);
      },
    },
    {
      id: 4,
      title: 'Create GMP rooms in 2D / Split view',
      actionLabel: 'Room Tool',
      run: () => {
        setViewMode('split');
        setLeftTab('spaces');
        setActiveTool('draw-room');
      },
    },
    {
      id: 5,
      title: 'Draw partition walls & doors',
      actionLabel: 'Wall Tool',
      run: () => {
        setViewMode('split');
        setActiveTool('draw-wall');
      },
    },
    {
      id: 6,
      title: 'Place smart equipment from library',
      actionLabel: 'Object Lib',
      run: () => {
        setLeftTab('objects');
        setActiveTool('place-object');
      },
    },
    {
      id: 7,
      title: 'Apply PBR cleanroom materials',
      actionLabel: 'Materials',
      run: () => {
        setRightTab('materials');
        setActiveTool('paint-material');
      },
    },
    {
      id: 8,
      title: 'Save a 3D camera viewpoint',
      actionLabel: 'Cameras',
      run: () => {
        setRightTab('cameras');
        completeStep(8);
      },
    },
    {
      id: 9,
      title: 'Inspect in full 3D Studio view',
      actionLabel: '3D Studio',
      run: () => {
        setViewMode('3d-perspective');
        completeStep(9);
      },
    },
    {
      id: 10,
      title: 'Launch Immersive Walkthrough / QR Inspector',
      actionLabel: 'XR Viewer',
      run: () => {
        setShowXRModal(true);
        completeStep(10);
      },
    },
  ];

  const doneCount = completedSteps.length;

  return (
    <aside className="fixed bottom-12 right-5 z-40 w-80 bg-white dark:bg-[#121216] border border-slate-200 dark:border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-violet-500" />
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Quick-Start Twin Guide
            </div>
            <div className="text-[11px] font-mono text-slate-500">
              {doneCount} / {steps.length} completed
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowOnboarding(false)}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#22222C] text-slate-400"
          title="Dismiss Quick-Start Guide"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="h-1 bg-slate-100 dark:bg-[#1C1C24]">
        <div
          className="h-full bg-violet-600 transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/80">
        {steps.map((step) => {
          const done = completedSteps.includes(step.id);
          return (
            <div
              key={step.id}
              className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs"
            >
              <button
                onClick={() => completeStep(step.id)}
                className="flex items-center gap-2 text-left min-w-0 flex-1"
              >
                {done ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
                )}
                <span
                  className={`truncate ${
                    done
                      ? 'line-through text-slate-400'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {step.id}. {step.title}
                </span>
              </button>
              <button
                onClick={step.run}
                className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#1C1C24] hover:bg-violet-600 hover:text-white text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors"
              >
                {step.actionLabel}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
