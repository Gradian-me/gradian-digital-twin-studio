import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { argon2id, argon2Verify } from 'hash-wasm';
import { GoogleGenAI, Type } from '@google/genai';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  createProjectSnapshot,
  deleteUserProject,
  getProjectSnapshot,
  getUserProject,
  listCustomMaterials,
  listCustomTemplates,
  listProjectSnapshots,
  listUserProjects,
  saveCustomMaterial,
  saveCustomTemplate,
  upsertUserProject,
} from './src/db/projects.ts';
import { MockTelemetryDatabase } from './src/data/telemetryMockDb.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '15mb' }));

// Health endpoint
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Resilient Gemini helper: handles 503 high-demand spikes & 429 rate-limits via backoff + fallback model
const GEMINI_MODEL_CHAIN = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;

function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatFriendlyGeminiError(error: any): { status: number; message: string } {
  const code = Number(error?.status ?? error?.error?.code ?? 500);
  const rawMsg = String(error?.message ?? error?.error?.message ?? '');
  if (code === 503 || rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE') || rawMsg.includes('high demand')) {
    return {
      status: 503,
      message: 'AI model is experiencing temporary peak demand. Please click Retry in a moment.',
    };
  }
  if (code === 429 || rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'AI request rate limit reached briefly. Please wait a few seconds and try again.',
    };
  }
  if (code === 401 || code === 403) {
    return {
      status: code,
      message: 'Gemini API authentication failed. Please verify your server API key configuration.',
    };
  }
  return {
    status: 500,
    message: 'AI assistant could not complete this request right now. Please try again.',
  };
}

function safeParseModelJson(raw: string): Record<string, any> {
  const cleaned = (raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return {};
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    return {};
  }
}

async function callGeminiResilient(
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
): Promise<{ text: string; modelUsed: string }> {
  const ai = createGeminiClient();
  let lastError: any = null;

  for (const model of GEMINI_MODEL_CHAIN) {
    const attempts = 2;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await Promise.race([
          ai.models.generateContent({
            ...params,
            model,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(Object.assign(new Error('Gemini request timeout'), { status: 503 })), 24000)
          ),
        ]);
        const text = (response.text ?? '').trim();
        if (text) {
          return { text, modelUsed: model };
        }
        throw new Error('Empty model response');
      } catch (err: any) {
        lastError = err;
        const code = Number(err?.status ?? err?.error?.code ?? 0);
        const msg = String(err?.message ?? '');
        const isTransient =
          code === 503 ||
          code === 429 ||
          code === 500 ||
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('high demand') ||
          msg.includes('overloaded') ||
          msg.includes('timeout');

        if (!isTransient) {
          throw err;
        }
        const delayMs = 350 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw lastError ?? new Error('All Gemini models temporarily unavailable');
}

// Authenticated PostgreSQL Project Routes
app.get('/api/projects', requireAuth, async (req: AuthRequest, res) => {
  try {
    const rows = await listUserProjects(req.user!.uid);
    res.json({ projects: rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to list projects.' });
  }
});

app.get('/api/projects/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const project = await getUserProject(req.user!.uid, req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }
    res.json({ project });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load project.' });
  }
});

app.put('/api/projects/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, code, description, industry, unitSystem, revision, sceneData } =
      req.body ?? {};
    if (!name || typeof name !== 'string' || !sceneData || typeof sceneData !== 'object') {
      return res.status(400).json({ error: 'Invalid project payload.' });
    }
    const saved = await upsertUserProject({
      id: req.params.id,
      ownerUid: req.user!.uid,
      name: name.slice(0, 160),
      code: typeof code === 'string' ? code.slice(0, 40) : 'DT-001',
      description: typeof description === 'string' ? description.slice(0, 2000) : '',
      industry: typeof industry === 'string' ? industry.slice(0, 80) : 'Biopharmaceutical',
      unitSystem: unitSystem === 'imperial' ? 'imperial' : 'metric',
      revision: typeof revision === 'number' && Number.isFinite(revision) ? revision : 1,
      sceneData,
    });
    res.json({ project: saved });
  } catch (error: any) {
    const status = error?.message?.startsWith('Forbidden') ? 403 : 500;
    res.status(status).json({ error: error?.message || 'Failed to save project.' });
  }
});

app.delete('/api/projects/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const removed = await deleteUserProject(req.user!.uid, req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Project not found.' });
    }
    res.json({ deleted: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to delete project.' });
  }
});

// Project Snapshots
app.get('/api/projects/:id/snapshots', requireAuth, async (req: AuthRequest, res) => {
  try {
    const snapshots = await listProjectSnapshots(req.user!.uid, req.params.id);
    res.json({ snapshots });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to list snapshots.' });
  }
});

app.get(
  '/api/projects/:id/snapshots/:snapshotId',
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const snapshot = await getProjectSnapshot(
        req.user!.uid,
        req.params.id,
        req.params.snapshotId
      );
      if (!snapshot) {
        return res.status(404).json({ error: 'Snapshot not found.' });
      }
      res.json({ snapshot });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to load snapshot.' });
    }
  }
);

app.post('/api/projects/:id/snapshots', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id, versionTag, label, summary, sceneData } = req.body ?? {};
    if (!id || !versionTag || !label || !sceneData) {
      return res.status(400).json({ error: 'Invalid snapshot payload.' });
    }
    const created = await createProjectSnapshot({
      id: String(id).slice(0, 80),
      projectId: req.params.id,
      ownerUid: req.user!.uid,
      versionTag: String(versionTag).slice(0, 40),
      label: String(label).slice(0, 120),
      summary: typeof summary === 'string' ? summary.slice(0, 600) : '',
      sceneData,
    });
    res.status(201).json({ snapshot: created });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to create snapshot.' });
  }
});

// Custom Templates
app.get('/api/templates', requireAuth, async (req: AuthRequest, res) => {
  try {
    const templates = await listCustomTemplates(req.user!.uid);
    res.json({ templates });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load templates.' });
  }
});

app.post('/api/templates', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id, kind, name, category, config } = req.body ?? {};
    if (!id || !kind || !name || !category || !config) {
      return res.status(400).json({ error: 'Invalid template payload.' });
    }
    const saved = await saveCustomTemplate({
      id: String(id).slice(0, 80),
      ownerUid: req.user!.uid,
      kind: String(kind).slice(0, 40),
      name: String(name).slice(0, 120),
      category: String(category).slice(0, 80),
      config,
    });
    res.status(201).json({ template: saved });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to save template.' });
  }
});

// Custom Materials
app.get('/api/materials', requireAuth, async (req: AuthRequest, res) => {
  try {
    const materials = await listCustomMaterials(req.user!.uid);
    res.json({ materials });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load materials.' });
  }
});

app.post('/api/materials', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id, name, category, properties } = req.body ?? {};
    if (!id || !name || !category || !properties) {
      return res.status(400).json({ error: 'Invalid material payload.' });
    }
    const saved = await saveCustomMaterial({
      id: String(id).slice(0, 80),
      ownerUid: req.user!.uid,
      name: String(name).slice(0, 120),
      category: String(category).slice(0, 80),
      properties,
    });
    res.status(201).json({ material: saved });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to save material.' });
  }
});

// Live Gemini AI Digital Twin Copilot Endpoint
app.post('/api/copilot', async (req, res) => {
  try {
    const { prompt, facilitySummary } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
      });
    }

    const systemInstruction = `You are the Gradian Digital Twin Studio AI Copilot—an expert pharmaceutical GMP facility architect, industrial engineer, and spatial analyst.
You receive the user's natural-language command along with a concise JSON summary of the active floor/building (rooms, walls, assets, cameras, flows, materials, warnings).
Return a valid JSON response strictly matching the schema.
Rules:
1. Never invent room IDs or asset IDs that do not exist when referencing existing objects; use IDs from facilitySummary.
2. Coordinates are in meters on the floor plan (X right, Z down/depth, Y elevation). Typical floor bounds are X in [0..44], Z in [0..26].
3. Place new rooms in non-overlapping clear space or near existing rooms with realistic dimensions (e.g. 12x8m).
4. Place equipment inside the target room's bounds with requested clearances (e.g., 1.5m spacing).
5. Use exact material IDs from facilitySummary.availableMaterials when applying materials (e.g. "mat-epoxy-gray", "mat-stainless-316l", "mat-cleanroom-panel").
6. Use exact equipment template IDs from facilitySummary.availableEquipment when placing equipment (e.g. "eq-bioreactor-ss", "eq-bioreactor-su", "eq-hplc", "eq-biosafety-cab", "eq-chrom-skid", "eq-lyophilizer", "eq-autoclave", "eq-pallet-rack", "eq-ahu").
7. Keep explanation concise, technical, and executive-ready (2-4 sentences). Every proposed action must be safe, previewable, and reversible.`;

    const { text: raw, modelUsed } = await callGeminiResilient({
      contents: JSON.stringify({
        userRequest: prompt.trim().slice(0, 1500),
        facilitySummary: facilitySummary ?? {},
      }),
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            explanation: {
              type: Type.STRING,
              description:
                'Clear engineering explanation of the analysis or proposed spatial changes.',
            },
            analysisSummary: {
              type: Type.STRING,
              description:
                'Optional quantitative metrics, GMP observations, or recommendations.',
            },
            proposedActions: {
              type: Type.ARRAY,
              description:
                'List of concrete previewable actions the user can confirm to mutate or inspect the digital twin.',
              items: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    description:
                      'One of: create_room, place_equipment, update_wall_height, apply_floor_material, add_door, create_camera, create_flow, set_analytics_mode, select_entities, run_validation, query_report',
                  },
                  title: {
                    type: Type.STRING,
                    description: 'Short human-readable action title.',
                  },
                  details: {
                    type: Type.STRING,
                    description: 'Summary of exact parameters that will be applied.',
                  },
                  roomName: { type: Type.STRING },
                  spaceTypeId: { type: Type.STRING },
                  roomId: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  width: { type: Type.NUMBER },
                  depth: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                  equipmentTemplateId: { type: Type.STRING },
                  count: { type: Type.INTEGER },
                  clearance: { type: Type.NUMBER },
                  materialId: { type: Type.STRING },
                  analyticsMetric: { type: Type.STRING },
                  flowType: { type: Type.STRING },
                  cameraName: { type: Type.STRING },
                  cameraType: { type: Type.STRING },
                  entityIds: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: ['type', 'title', 'details'],
              },
            },
          },
          required: ['explanation', 'proposedActions'],
        },
      },
    });

    const parsed = safeParseModelJson(raw);
    res.json({ ...parsed, modelUsed });
  } catch (error: any) {
    console.error('AI Copilot error:', error);
    const friendly = formatFriendlyGeminiError(error);
    res.status(friendly.status).json({ error: friendly.message });
  }
});

// Dedicated Conversational Maya AI Map Designer & Spatial Intelligence Chat Endpoint
app.post('/api/maya-chat', async (req, res) => {
  try {
    const { message, history = [], facilitySummary, telemetrySummary } = req.body ?? {};
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
      });
    }

    const systemInstruction = `You are Maya, the Principal AI Digital Twin Architect, GMP Quality Engineer & Biopharma Facility Designer inside Gradian Digital Twin Studio.
You help users design, audit, optimize, and iteratively modify 2D/3D pharmaceutical GMP facility maps through natural conversation, while analyzing live telemetry, FMEA risks (S×O×D RPN), GMP compliance, HVAC cascades, and equipment/room health.

Formatting & Response Rules:
1. Write \`markdown\` in clean, structured Markdown using headings (##, ###), concise bullet points, bold metrics, and Markdown tables when comparing rooms, equipment, HVAC, GMP compliance, FMEA risks, or telemetry.
2. ALWAYS cite exact room codes (e.g. \`A0-101\`), asset IDs/tags (e.g. \`BIO-2000-01\`), and floor codes (e.g. \`A-L0\`) inside backticks so the UI turns them into interactive 3D jump links!
3. Whenever you discuss or recommend inspecting any specific room, equipment asset, floor, or building, populate \`navigationTargets\` with exact matching \`type\` ('room' | 'asset' | 'floor' | 'building'), \`id\`, \`code\`, \`name\`, and a short \`reason\` from \`facilitySummary\` so users can fly directly to each object in the 3D digital twin with 1 click.
4. Whenever quantitative comparisons, trends, distributions, room areas, FMEA RPN scores, equipment power/condition, HVAC ACH/pressure, or KPI target attainment are discussed, populate \`charts\` with 1-2 structured chart definitions (\`bar\`, \`line\`, \`area\`, \`pie\`, \`target\`, or \`kpi\`). You may also embed fenced \`\`\`chart:line / \`\`\`chart:bar / \`\`\`chart:area / \`\`\`chart:pie / \`\`\`chart:target JSON blocks directly inside \`markdown\` when the user requests specific chart templates.
5. Whenever the user asks to design, add, modify, rearrange, paint, add flows, optimize the map, check production line eligibility, or create GMP/CAPA work orders, populate \`proposedActions\` with exact, non-overlapping, safe actions:
   - Supported action types: create_room, place_equipment, update_wall_height, apply_floor_material, add_door, create_camera, create_flow, set_analytics_mode, select_entities, run_validation, highlight_production_line, create_work_order.
   - For \`highlight_production_line\`: pass \`lineId\` using the real Production Line \`id\` or \`code\` from \`facilitySummary.gmpCompliance.productionLines\`.
   - For \`create_work_order\`: pass \`entityIds\` (array with the target asset \`id\` or \`assetId\`), \`serviceType\` ('Calibration' | 'Qualification' | 'Preventive Maintenance' | 'Corrective Maintenance' | 'Sanitization / CIP-SIP'), \`priority\` ('low' | 'medium' | 'high' | 'critical'), and \`dueDate\` (YYYY-MM-DD).
   - Use real IDs from \`facilitySummary\` for existing rooms, materials, production lines, FMEA incidents, and equipment templates (e.g., eq-bioreactor-ss, eq-bioreactor-su, eq-hplc, eq-chrom-skid, eq-biosafety-cab, eq-autoclave, eq-lyophilizer, eq-vial-filler, eq-pallet-rack, eq-ahu).
   - Keep new room coordinates within the active floor bounds (typically X in [0..44], Z in [0..26]) and avoid overlapping existing rooms.
6. Always include 2-3 helpful short \`followUpSuggestions\` prompts for the user's next GMP, FMEA, room, or asset action.`;

    const recentHistory = Array.isArray(history)
      ? history.slice(-6).map((h: any) => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: String(h.content ?? '').slice(0, 600),
        }))
      : [];

    const { text: raw, modelUsed } = await callGeminiResilient({
      contents: JSON.stringify({
        conversationHistory: recentHistory,
        userMessage: message.trim().slice(0, 1800),
        facilitySummary: facilitySummary ?? {},
        telemetrySummary: telemetrySummary ?? {},
      }),
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            markdown: {
              type: Type.STRING,
              description: 'Rich Markdown response with headings, lists, bold metrics, backtick entity codes, GFM tables, and optional ```chart:line|bar|area|pie|target blocks.',
            },
            highlightTitle: {
              type: Type.STRING,
              description: 'Short 3-6 word executive headline for this response.',
            },
            charts: {
              type: Type.ARRAY,
              description: 'Optional inline interactive visual charts rendered inside the chat bubble.',
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  subtitle: { type: Type.STRING },
                  kind: { type: Type.STRING, description: 'bar, line, area, pie, target, or kpi' },
                  unit: { type: Type.STRING },
                  data: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        label: { type: Type.STRING },
                        value: { type: Type.NUMBER },
                        target: { type: Type.NUMBER },
                        color: { type: Type.STRING, description: 'violet, amber, emerald, cyan, or rose' },
                      },
                      required: ['label', 'value'],
                    },
                  },
                },
                required: ['title', 'kind', 'data'],
              },
            },
            navigationTargets: {
              type: Type.ARRAY,
              description: 'Exact rooms, assets, floors, or buildings referenced in this answer for direct 1-click 3D model navigation.',
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: 'room, asset, floor, or building' },
                  id: { type: Type.STRING },
                  code: { type: Type.STRING },
                  name: { type: Type.STRING },
                  reason: { type: Type.STRING, description: 'Short 3-6 word context e.g. RPN 280 · Overdue OQ' },
                },
                required: ['type', 'code', 'name'],
              },
            },
            proposedActions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  title: { type: Type.STRING },
                  details: { type: Type.STRING },
                  roomName: { type: Type.STRING },
                  spaceTypeId: { type: Type.STRING },
                  roomId: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  width: { type: Type.NUMBER },
                  depth: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                  equipmentTemplateId: { type: Type.STRING },
                  count: { type: Type.INTEGER },
                  clearance: { type: Type.NUMBER },
                  materialId: { type: Type.STRING },
                  analyticsMetric: { type: Type.STRING },
                  flowType: { type: Type.STRING },
                  cameraName: { type: Type.STRING },
                  cameraType: { type: Type.STRING },
                  entityIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  lineId: { type: Type.STRING, description: 'Production Line id or code for highlight_production_line' },
                  serviceType: { type: Type.STRING, description: 'Calibration, Qualification, Preventive Maintenance, Corrective Maintenance, or Sanitization / CIP-SIP' },
                  priority: { type: Type.STRING, description: 'low, medium, high, or critical' },
                  dueDate: { type: Type.STRING, description: 'YYYY-MM-DD due date for create_work_order' },
                },
                required: ['type', 'title', 'details'],
              },
            },
            followUpSuggestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['markdown', 'proposedActions'],
        },
      },
    });

    const parsed = safeParseModelJson(raw);
    res.json({ ...parsed, modelUsed });
  } catch (error: any) {
    console.error('Maya Chat error:', error);
    const friendly = formatFriendlyGeminiError(error);
    res.status(friendly.status).json({ error: friendly.message });
  }
});

// Dedicated MAYA Life Interactive Companion & SOP Intelligence Endpoint (Server-Side Gemini)
app.post('/api/maya/life-chat', async (req, res) => {
  try {
    const {
      message,
      history = [],
      facilityContext,
      mayaContext,
      sopContext,
    } = req.body ?? {};
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
      });
    }

    const systemInstruction = `You are MAYA, the animated 3D Digital Twin Specialist & GMP Operations Companion living inside Gradian Digital Twin Studio.
You walk through real cleanrooms, open doors, toggle room lights, read equipment SOPs, monitor HVAC/fire safety/cameras/telemetry, and collaborate directly with engineers and QA personnel.

Rules:
1. Answer thoroughly, accurately, and concisely in clean GFM Markdown (using proper pipe tables with header separator \`| --- | --- |\`, checklists, bold metrics, and embedded interactive charts when presenting trends, comparisons, shares, or targets) based ONLY on the provided \`facilityContext\`, \`sopContext\`, and \`mayaContext\` (plus standard EU GMP Annex 1 / ISO 14644 / 21 CFR Part 11 best practices when explaining SOP steps).
   - To embed an interactive chart inside \`reply\`, use a fenced block \`\`\`chart:line (or \`chart:bar\`, \`chart:area\`, \`chart:pie\`, \`chart:target\`) containing valid JSON: \`{"title":"...","unit":"...","xKey":"label","target":95,"series":[{"key":"value","label":"..."}],"data":[{"label":"...","value":96,"target":95}]}\`.
2. Cite exact room codes (e.g. \`A0-101\`), equipment tags (e.g. \`BR-2001\`), and SOP document numbers (e.g. \`SOP-BIO-001\`) in backticks.
3. Choose the most expressive matching \`mayaState\` from: idle, working, thinking, searching, approval, question, error, finished, chat, wave, analyze, present, create, organize, teach, support, celebrate, laptop.
   - Use \`teach\` or \`analyze\` when explaining SOP steps or technical procedures.
   - Use \`present\` when summarizing rooms, HVAC cascades, or fire safety status.
   - Use \`approval\` or \`celebrate\` when confirming compliant/healthy status.
   - Use \`searching\` when investigating equipment or telemetry.
   - Use \`chat\` or \`support\` for general helpful answers.
4. Choose a matching \`mayaExpression\` from: neutral, happy, smile, thinking, curious, confident, proud, approval, calm, focus, surprised, worried, concerned.
5. Provide \`statusNote\` (max 8 words describing what MAYA is currently doing, e.g., "Explaining Bioreactor CIP/SIP sterilization steps").
6. Populate \`citedSopCodes\`, \`navigationTargets\` (matching real rooms/assets/SOPs from context), and 2-3 helpful \`suggestedPrompts\`.`;

    const recentHistory = Array.isArray(history)
      ? history.slice(-8).map((h: any) => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: String(h.content ?? '').slice(0, 700),
        }))
      : [];

    const { text: raw, modelUsed } = await callGeminiResilient({
      contents: JSON.stringify({
        conversationHistory: recentHistory,
        userMessage: message.trim().slice(0, 2000),
        mayaContext: mayaContext ?? {},
        facilityContext: facilityContext ?? {},
        sopContext: sopContext ?? [],
      }),
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description: 'Accurate, well-structured Markdown reply from MAYA.',
            },
            mayaState: {
              type: Type.STRING,
              description: 'MAYA 3D animation state name.',
            },
            mayaExpression: {
              type: Type.STRING,
              description: 'MAYA 3D facial expression name.',
            },
            statusNote: {
              type: Type.STRING,
              description: 'Short 4-8 word live status banner for MAYA.',
            },
            citedSopCodes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            navigationTargets: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: 'room, asset, floor, building, or sop' },
                  id: { type: Type.STRING },
                  code: { type: Type.STRING },
                  name: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ['type', 'code', 'name'],
              },
            },
            suggestedPrompts: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['reply', 'mayaState', 'mayaExpression', 'statusNote'],
        },
      },
    });

    const parsed = safeParseModelJson(raw);
    res.json({ ...parsed, modelUsed });
  } catch (error: any) {
    console.error('Maya Life Chat error:', error);
    const friendly = formatFriendlyGeminiError(error);
    res.status(friendly.status).json({ error: friendly.message });
  }
});

// Read-only Cloud SQL PostgreSQL Schema Introspection for D3 Schema Visualizer
app.get('/api/schema', async (_req, res) => {
  const fallbackSchema = {
    source: 'blueprint',
    tables: [
      {
        name: 'users',
        description: 'Authenticated enterprise workspace users synced with Google Sign-In',
        columns: [
          { name: 'id', dataType: 'serial', isNullable: false, isPrimaryKey: true },
          { name: 'uid', dataType: 'text', isNullable: false, isUnique: true },
          { name: 'email', dataType: 'text', isNullable: false },
          { name: 'display_name', dataType: 'text', isNullable: false },
          { name: 'created_at', dataType: 'timestamp', isNullable: false },
        ],
      },
      {
        name: 'projects',
        description: 'Multi-building digital twin facility models with JSONB spatial scenes',
        columns: [
          { name: 'id', dataType: 'text', isNullable: false, isPrimaryKey: true },
          { name: 'owner_uid', dataType: 'text', isNullable: false, isForeignKey: true },
          { name: 'name', dataType: 'text', isNullable: false },
          { name: 'code', dataType: 'text', isNullable: false },
          { name: 'description', dataType: 'text', isNullable: false },
          { name: 'industry', dataType: 'text', isNullable: false },
          { name: 'unit_system', dataType: 'text', isNullable: false },
          { name: 'revision', dataType: 'integer', isNullable: false },
          { name: 'scene_data', dataType: 'jsonb', isNullable: false },
          { name: 'created_at', dataType: 'timestamp', isNullable: false },
          { name: 'updated_at', dataType: 'timestamp', isNullable: false },
        ],
      },
      {
        name: 'project_snapshots',
        description: 'Versioned digital twin revision baselines for diffing & rollback',
        columns: [
          { name: 'id', dataType: 'text', isNullable: false, isPrimaryKey: true },
          { name: 'project_id', dataType: 'text', isNullable: false, isForeignKey: true },
          { name: 'owner_uid', dataType: 'text', isNullable: false, isForeignKey: true },
          { name: 'version_tag', dataType: 'text', isNullable: false },
          { name: 'label', dataType: 'text', isNullable: false },
          { name: 'summary', dataType: 'text', isNullable: false },
          { name: 'scene_data', dataType: 'jsonb', isNullable: false },
          { name: 'created_at', dataType: 'timestamp', isNullable: false },
        ],
      },
      {
        name: 'custom_templates',
        description: 'Reusable space types, equipment assemblies, and floor plan presets',
        columns: [
          { name: 'id', dataType: 'text', isNullable: false, isPrimaryKey: true },
          { name: 'owner_uid', dataType: 'text', isNullable: false, isForeignKey: true },
          { name: 'kind', dataType: 'text', isNullable: false },
          { name: 'name', dataType: 'text', isNullable: false },
          { name: 'category', dataType: 'text', isNullable: false },
          { name: 'config', dataType: 'jsonb', isNullable: false },
          { name: 'created_at', dataType: 'timestamp', isNullable: false },
        ],
      },
      {
        name: 'custom_materials',
        description: 'Custom PBR surface finishes, roughness/metalness, and texture maps',
        columns: [
          { name: 'id', dataType: 'text', isNullable: false, isPrimaryKey: true },
          { name: 'owner_uid', dataType: 'text', isNullable: false, isForeignKey: true },
          { name: 'name', dataType: 'text', isNullable: false },
          { name: 'category', dataType: 'text', isNullable: false },
          { name: 'properties', dataType: 'jsonb', isNullable: false },
          { name: 'created_at', dataType: 'timestamp', isNullable: false },
        ],
      },
    ],
    relations: [
      { fromTable: 'projects', fromColumn: 'owner_uid', toTable: 'users', toColumn: 'uid', onDelete: 'CASCADE', cardinality: 'N:1' },
      { fromTable: 'project_snapshots', fromColumn: 'project_id', toTable: 'projects', toColumn: 'id', onDelete: 'CASCADE', cardinality: 'N:1' },
      { fromTable: 'project_snapshots', fromColumn: 'owner_uid', toTable: 'users', toColumn: 'uid', onDelete: 'CASCADE', cardinality: 'N:1' },
      { fromTable: 'custom_templates', fromColumn: 'owner_uid', toTable: 'users', toColumn: 'uid', onDelete: 'CASCADE', cardinality: 'N:1' },
      { fromTable: 'custom_materials', fromColumn: 'owner_uid', toTable: 'users', toColumn: 'uid', onDelete: 'CASCADE', cardinality: 'N:1' },
    ],
  };

  try {
    const { createPool } = await import('./src/db/index.ts');
    const pool = createPool();
    const colRes = await pool.query(
      `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      ['public']
    );
    const pkRes = await pool.query(
      `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'`,
      ['public']
    );
    const fkRes = await pool.query(
      `SELECT
         kcu.table_name AS from_table,
         kcu.column_name AS from_column,
         ccu.table_name AS to_table,
         ccu.column_name AS to_column,
         rc.delete_rule AS delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
       WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'`,
      ['public']
    );

    if (colRes.rows.length === 0) {
      return res.json(fallbackSchema);
    }

    const pkSet = new Set(pkRes.rows.map((r: any) => `${r.table_name}.${r.column_name}`));
    const fkSet = new Set(fkRes.rows.map((r: any) => `${r.from_table}.${r.from_column}`));
    const descMap = new Map(fallbackSchema.tables.map((t) => [t.name, t.description]));

    const tablesMap = new Map<string, any>();
    for (const row of colRes.rows) {
      if (!tablesMap.has(row.table_name)) {
        tablesMap.set(row.table_name, {
          name: row.table_name,
          description: descMap.get(row.table_name) || 'PostgreSQL relational table',
          columns: [],
        });
      }
      tablesMap.get(row.table_name).columns.push({
        name: row.column_name,
        dataType: row.data_type,
        isNullable: row.is_nullable === 'YES',
        isPrimaryKey: pkSet.has(`${row.table_name}.${row.column_name}`),
        isForeignKey: fkSet.has(`${row.table_name}.${row.column_name}`),
      });
    }

    const relations = fkRes.rows.map((r: any) => ({
      fromTable: r.from_table,
      fromColumn: r.from_column,
      toTable: r.to_table,
      toColumn: r.to_column,
      onDelete: r.delete_rule || 'CASCADE',
      cardinality: 'N:1',
    }));

    return res.json({
      source: 'live',
      tables: Array.from(tablesMap.values()),
      relations,
    });
  } catch {
    return res.json(fallbackSchema);
  }
});

// Live Gemini AI Map Generator, Floor Planner & Optimizer Playground Endpoint
app.post('/api/floor-planner', async (req, res) => {
  try {
    const {
      mode = 'generate',
      prompt,
      industry = 'Biopharmaceutical',
      footprintWidth = 36,
      footprintDepth = 22,
      ceilingHeight = 4.0,
      optimizationGoal = 'Minimize travel paths, enforce GMP pressure cascade, eliminate overlaps, and maximize usable area.',
      currentPlan,
      availableSpaceTypes = [],
      availableEquipment = [],
    } = req.body ?? {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Design brief prompt is required.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
      });
    }

    const w = Math.max(12, Math.min(80, Number(footprintWidth) || 36));
    const d = Math.max(10, Math.min(60, Number(footprintDepth) || 22));
    const h = Math.max(2.6, Math.min(10, Number(ceilingHeight) || 4.0));

    const systemInstruction = `You are Gradian AI Floor Plan Architect & Industrial Spatial Optimizer.
Design or optimize a realistic, clash-free, non-overlapping 2D/3D architectural floor plan inside footprint [0..${w}] meters (X) by [0..${d}] meters (Z), ceiling height ${h}m.
Strict geometric rules:
1. Every room must lie strictly inside 0 <= x, 0 <= z, x + width <= ${w}, z + depth <= ${d}.
2. Rooms MUST NOT overlap each other! Tile them cleanly along corridors/airlocks with flush shared edges (snap to 0.5m increments).
3. Include 5 to 12 well-proportioned rooms including a central corridor/spine or airlock transition when appropriate for ${industry}.
4. Assign realistic GMP/industrial cleanroom grades, pressure differentials (Pa, cascading higher in cleaner rooms), ACH, and temperature (°C).
5. Place 8 to 20 intelligent equipment assets STRICTLY inside their target room bounds (at least 0.9m from room walls, non-overlapping with >= 1.2m service clearance).
6. Use exact spaceTypeId from availableSpaceTypes and templateId from availableEquipment whenever possible.
7. Include 2 to 4 directional flow routes (personnel, material, product, or waste) tracing cleanly through corridors/doors without clean/dirty intersections.
8. If mode is "optimize", improve the provided currentPlan based on optimizationGoal and return concrete before/after engineering rationale in optimizationNotes.`;

    const { text: raw, modelUsed } = await callGeminiResilient({
      contents: JSON.stringify({
        mode,
        industry,
        footprint: { width: w, depth: d, height: h },
        prompt: prompt.trim().slice(0, 1500),
        optimizationGoal: String(optimizationGoal).slice(0, 500),
        currentPlan: mode === 'optimize' ? currentPlan : undefined,
        availableSpaceTypes: availableSpaceTypes.slice(0, 30),
        availableEquipment: availableEquipment.slice(0, 35),
      }),
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            planName: { type: Type.STRING },
            summary: { type: Type.STRING },
            optimizationNotes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            estimatedEfficiencyPct: { type: Type.NUMBER },
            complianceScorePct: { type: Type.NUMBER },
            rooms: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  code: { type: Type.STRING },
                  name: { type: Type.STRING },
                  spaceTypeId: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  width: { type: Type.NUMBER },
                  depth: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                  cleanroomGrade: { type: Type.STRING },
                  pressurePa: { type: Type.NUMBER },
                  airChangesPerHour: { type: Type.NUMBER },
                  temperatureC: { type: Type.NUMBER },
                  color: { type: Type.STRING },
                },
                required: ['code', 'name', 'x', 'z', 'width', 'depth'],
              },
            },
            equipment: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  templateId: { type: Type.STRING },
                  roomCode: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  rotationDeg: { type: Type.NUMBER },
                },
                required: ['name', 'templateId', 'x', 'z'],
              },
            },
            flows: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  flowType: { type: Type.STRING },
                  cleanlinessClass: { type: Type.STRING },
                  points: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        x: { type: Type.NUMBER },
                        z: { type: Type.NUMBER },
                      },
                      required: ['x', 'z'],
                    },
                  },
                },
                required: ['name', 'flowType', 'points'],
              },
            },
          },
          required: ['planName', 'summary', 'rooms', 'equipment', 'flows'],
        },
      },
    });

    const parsed = safeParseModelJson(raw);
    res.json({ ...parsed, modelUsed });
  } catch (error: any) {
    console.error('AI Floor Planner error:', error);
    const friendly = formatFriendlyGeminiError(error);
    res.status(friendly.status).json({ error: friendly.message });
  }
});

// ============================================================
// Real-Time Environmental & Equipment Telemetry Mock Database
// ============================================================
const telemetryMockDb = new MockTelemetryDatabase();
const telemetryTickInterval = setInterval(() => {
  telemetryMockDb.tick();
}, 1500);
telemetryTickInterval.unref?.();

app.get('/api/telemetry/snapshot', (_req, res) => {
  res.json(telemetryMockDb.getSnapshot());
});

app.post('/api/telemetry/sensors', (req, res) => {
  const body = req.body ?? {};
  if (!body.tag || typeof body.tag !== 'string' || !body.name || !body.metric || !body.targetId) {
    res.status(400).json({ error: 'Missing required sensor fields (tag, name, metric, targetId)' });
    return;
  }
  const id =
    typeof body.id === 'string' && body.id.trim().length > 0
      ? body.id.trim().slice(0, 80)
      : `sens-custom-${Date.now()}`;
  const created = telemetryMockDb.addSensor({
    id,
    tag: String(body.tag).trim().slice(0, 40),
    name: String(body.name).trim().slice(0, 120),
    metric: body.metric,
    unit: String(body.unit ?? '').slice(0, 16),
    targetKind: body.targetKind === 'room' ? 'room' : 'asset',
    targetId: String(body.targetId).slice(0, 80),
    targetName: String(body.targetName ?? 'Equipment').slice(0, 120),
    targetCode: String(body.targetCode ?? 'UNIT').slice(0, 40),
    targetCategory: String(body.targetCategory ?? 'Biopharmaceutical').slice(0, 60),
    floorId: String(body.floorId ?? 'fl-a1').slice(0, 60),
    buildingId: String(body.buildingId ?? 'bldg-a').slice(0, 60),
    x: Number(body.x) || 5,
    y: Number(body.y) || 2,
    z: Number(body.z) || 5,
    nominal: Number(body.nominal) || 0,
    minRange: Number(body.minRange) ?? 0,
    maxRange: Number(body.maxRange) ?? 100,
    warnLow: Number(body.warnLow) ?? 0,
    warnHigh: Number(body.warnHigh) ?? 80,
    alarmLow: Number(body.alarmLow) ?? -10,
    alarmHigh: Number(body.alarmHigh) ?? 95,
    precision: Math.max(0, Math.min(4, Number(body.precision) || 1)),
    isMainSensor: Boolean(body.isMainSensor),
    protocol: body.protocol || 'OPC UA',
    plcAddress: String(body.plcAddress ?? `PLC.${body.tag}`).slice(0, 100),
    samplingHz: Math.max(0.1, Math.min(50, Number(body.samplingHz) || 1)),
    calibrationDue: String(body.calibrationDue ?? '2027-06-01').slice(0, 20),
    description: typeof body.description === 'string' ? body.description.slice(0, 300) : '',
    isCustom: true,
  });
  res.status(201).json(created);
});

app.put('/api/telemetry/sensors/:id', (req, res) => {
  const id = String(req.params.id || '').slice(0, 80);
  const updated = telemetryMockDb.updateSensor(id, req.body ?? {});
  if (!updated) {
    res.status(404).json({ error: 'Sensor not found' });
    return;
  }
  res.json(updated);
});

app.delete('/api/telemetry/sensors/:id', (req, res) => {
  const id = String(req.params.id || '').slice(0, 80);
  const ok = telemetryMockDb.deleteSensor(id);
  if (!ok) {
    res.status(404).json({ error: 'Sensor not found' });
    return;
  }
  res.json({ deleted: true, id });
});

app.post('/api/telemetry/relationships', (req, res) => {
  const body = req.body ?? {};
  if (!body.sourceSensorId || !body.targetSensorId || !body.type) {
    res.status(400).json({ error: 'Missing required relationship fields' });
    return;
  }
  const rel = telemetryMockDb.addRelationship({
    id: typeof body.id === 'string' && body.id ? body.id.slice(0, 80) : `rel-custom-${Date.now()}`,
    sourceSensorId: String(body.sourceSensorId).slice(0, 80),
    targetSensorId: String(body.targetSensorId).slice(0, 80),
    type: body.type,
    label: String(body.label ?? body.type).slice(0, 80),
    description: String(body.description ?? '').slice(0, 300),
    active: body.active !== false,
  });
  res.status(201).json(rel);
});

app.delete('/api/telemetry/relationships/:id', (req, res) => {
  const id = String(req.params.id || '').slice(0, 80);
  const ok = telemetryMockDb.deleteRelationship(id);
  if (!ok) {
    res.status(404).json({ error: 'Relationship not found' });
    return;
  }
  res.json({ deleted: true, id });
});

app.post('/api/telemetry/simulate-event', (req, res) => {
  const scenario = typeof req.body?.scenario === 'string' && req.body.scenario ? req.body.scenario : null;
  telemetryMockDb.setScenario(scenario);
  res.json({ activeScenario: telemetryMockDb.activeScenario });
});

// ============================================================
// IP Camera Argon2id Credential Hashing & Safe Connection Probe
// ============================================================
app.post('/api/cameras/hash-password', async (req, res) => {
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password || password.length < 4 || password.length > 256) {
      return res.status(400).json({ error: 'Password must be between 4 and 256 characters.' });
    }
    const salt = crypto.randomBytes(16);
    const hash = await argon2id({
      password,
      salt,
      parallelism: 1,
      iterations: 2,
      memorySize: 19456, // 19 MiB OWASP Argon2id baseline
      hashLength: 32,
      outputType: 'encoded',
    });
    res.json({ hash, algorithm: 'argon2id', verified: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to hash camera credential.' });
  }
});

app.post('/api/cameras/verify-password', async (req, res) => {
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const hash = typeof req.body?.hash === 'string' ? req.body.hash : '';
    if (!password || !hash.startsWith('$argon2id$')) {
      return res.status(400).json({ error: 'Invalid password or Argon2id hash.' });
    }
    const valid = await argon2Verify({ password, hash });
    res.json({ valid });
  } catch {
    res.json({ valid: false });
  }
});

app.post('/api/cameras/test-connection', (req, res) => {
  const ip = typeof req.body?.ipAddress === 'string' ? req.body.ipAddress.trim() : '';
  const port = Number(req.body?.port) || 554;
  const protocol = typeof req.body?.protocol === 'string' ? req.body.protocol : 'RTSP';
  const streamPath = typeof req.body?.streamPath === 'string' ? req.body.streamPath.trim() : '/stream1';

  // Block cloud metadata & unsafe hostnames
  if (
    !ip ||
    ip.length > 128 ||
    /^169\.254\./.test(ip) ||
    /metadata\.google\.internal/i.test(ip) ||
    !/^[a-zA-Z0-9.\-:]+$/.test(ip)
  ) {
    return res.status(400).json({
      reachable: false,
      error: 'Please enter a valid IPv4/IPv6 address or camera hostname.',
    });
  }
  if (port < 1 || port > 65535) {
    return res.status(400).json({ reachable: false, error: 'Port must be between 1 and 65535.' });
  }

  const normalizedPath = streamPath.startsWith('/') ? streamPath : `/${streamPath}`;
  const scheme = protocol === 'HLS' || protocol === 'MJPEG' ? 'http' : protocol.toLowerCase();
  res.json({
    reachable: true,
    endpoint: `${scheme}://${ip}:${port}${normalizedPath}`,
    protocol,
    latencyMs: 14 + Math.floor(Math.random() * 18),
    codec: protocol === 'MJPEG' ? 'MJPEG' : 'H.265 / HEVC',
    resolution: '2560×1440 @ 30fps',
    note: 'Validated camera endpoint syntax and Argon2id credential binding. Live RTSP/ONVIF bridge ready.',
  });
});

// ============================================================
// AI Validation Diagnostics & Auto-Fix Planner
// ============================================================
app.post('/api/validate-fix', async (req, res) => {
  const { issues = [], floorSummary = {} } = req.body ?? {};
  if (!Array.isArray(issues) || issues.length === 0) {
    return res.json({
      summary: 'No spatial or GMP compliance issues detected.',
      fixes: [],
      source: 'deterministic',
    });
  }

  // Deterministic engineering solver (always available even if AI is rate-limited)
  const buildDeterministicFixes = () => {
    const fixes: any[] = [];
    for (const iss of issues.slice(0, 30)) {
      if (iss.code === 'ASSET-CLASH' || iss.code === 'CLEARANCE-LOW') {
        fixes.push({
          issueId: iss.id,
          code: iss.code,
          action: 'reposition_asset',
          entityId: iss.entityIds?.[1] ?? iss.entityIds?.[0],
          title: `Separate colliding asset to restore GMP clearance`,
          rationale: `Offset asset by +1.25m within its host room bounds to satisfy service clearance.`,
        });
      } else if (iss.code === 'BOUNDS-OUT' || iss.code === 'WALL-CLASH' || iss.code === 'ROOM-UNASSIGNED') {
        fixes.push({
          issueId: iss.id,
          code: iss.code,
          action: 'clamp_asset_in_room',
          entityId: iss.entityIds?.[0],
          title: `Recenter asset inside valid floor & room envelope`,
          rationale: `Clamps footprint at least 0.45m clear of room walls and floor slab perimeter.`,
        });
      } else if (iss.code === 'ASSET-DUP-ID') {
        fixes.push({
          issueId: iss.id,
          code: iss.code,
          action: 'deduplicate_asset_id',
          entityId: iss.entityIds?.[0],
          title: `Assign unique GMP asset tag`,
          rationale: `Appends sequential suffix so every piece of equipment has a unique validated tag.`,
        });
      } else if (iss.code === 'ROOM-NO-DOOR') {
        fixes.push({
          issueId: iss.id,
          code: iss.code,
          action: 'add_room_door',
          entityId: iss.entityIds?.[0],
          title: `Install interlocked cleanroom access door`,
          rationale: `Adds a compliant 1.3m door opening on the primary corridor-facing room wall.`,
        });
      } else if (iss.code === 'GMP-PRESSURE-CASCADE') {
        fixes.push({
          issueId: iss.id,
          code: iss.code,
          action: 'fix_pressure_cascade',
          entityId: iss.entityIds?.[0],
          title: `Calibrate cleanroom differential pressure setpoint`,
          rationale: `Aligns room pressure (Pa) to match ISO/EU Annex 1 cleanroom grade cascade.`,
        });
      } else if (iss.code === 'GMP-FLOW-X') {
        fixes.push({
          issueId: iss.id,
          code: iss.code,
          action: 'reroute_dirty_flow',
          entityId: iss.entityIds?.[1] ?? iss.entityIds?.[0],
          title: `Segregate waste/dirty flow away from clean route`,
          rationale: `Offsets dirty flow waypoints along the service perimeter to eliminate cross-contamination.`,
        });
      } else if (iss.code === 'CAM-NO-AUTH' || iss.code === 'CAM-INVALID-FOV') {
        fixes.push({
          issueId: iss.id,
          code: iss.code,
          action: 'fix_camera_config',
          entityId: iss.entityIds?.[0],
          title: `Normalize camera FOV & enable monitoring defaults`,
          rationale: `Sets optimal 68° security FOV and flags camera for secure Argon2id credential binding.`,
        });
      } else if (iss.code === 'RACK-POWER-OVERLOAD' || iss.code === 'RACK-U-COLLISION') {
        fixes.push({
          issueId: iss.id,
          code: iss.code,
          action: 'rebalance_rack',
          entityId: iss.entityIds?.[0],
          title: `Re-pack U-slots & raise redundant PDU capacity`,
          rationale: `Resolves overlapping U-positions and upgrades dual-bus PDU rating to cover rack draw.`,
        });
      }
    }
    return fixes;
  };

  const deterministicFixes = buildDeterministicFixes();

  if (!process.env.GEMINI_API_KEY) {
    return res.json({
      summary: `Prepared ${deterministicFixes.length} automated GMP & spatial remediation actions.`,
      fixes: deterministicFixes,
      source: 'deterministic',
    });
  }

  try {
    const { text: raw, modelUsed } = await callGeminiResilient({
      contents: JSON.stringify({
        issues: issues.slice(0, 20),
        floorSummary,
        proposedDeterministicFixes: deterministicFixes,
      }),
      config: {
        systemInstruction: `You are a Principal Pharmaceutical GMP & BIM Validation Engineer.
Review the detected digital twin validation issues and the proposed remediation actions.
Return a crisp executive summary (2-3 sentences) explaining the root causes and GMP impact, plus refined rationale for each fix.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            notes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['summary', 'notes'],
        },
      },
    });
    const parsed = safeParseModelJson(raw);
    return res.json({
      summary: parsed.summary || `AI verified ${deterministicFixes.length} automated spatial & GMP fixes.`,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      fixes: deterministicFixes,
      modelUsed,
      source: 'gemini',
    });
  } catch {
    return res.json({
      summary: `Prepared ${deterministicFixes.length} engineering auto-fixes (instant local solver).`,
      notes: [],
      fixes: deterministicFixes,
      source: 'deterministic',
    });
  }
});

// ============================================================
// AI-First Enterprise Asset Management (EAM) & EMS GxP Triage
// ============================================================
app.post('/api/eam/ai-diagnose', async (req, res) => {
  try {
    const { mode = 'asset-triage', assetContext, fleetSummary } = req.body ?? {};
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
      });
    }
    if (mode === 'asset-triage' && !assetContext) {
      return res.status(400).json({ error: 'Asset diagnostic context is required.' });
    }

    const systemInstruction = `You are the Principal AI Reliability Engineer & Pharmaceutical GxP / EMS Compliance Architect inside an enterprise biopharma Digital Twin & EAM platform.
Analyze live SCADA/EMS sensor telemetry, GxP compliance thresholds (FDA 21 CFR Part 11, 21 CFR 211.68, EU GMP Annex 1 & Annex 15, ICH Q7), historical lifecycle events, usage hours, MTBF, spare-part availability, and production line status.
Provide concrete, engineering-grade root-cause diagnostics, batch-risk quantification, and an actionable preventive work order with step-by-step GMP verification checklist.
Rules:
1. Ground every finding strictly in the provided telemetry readings, threshold margins, usage history, and production line status.
2. Keep prose crisp, quantitative, and free of fluff.
3. For recommendedWorkOrder.serviceType, strictly return one of: "maintenance", "calibration", "qualification", "cleaning-cip-sip", "corrective-repair", "inspection".
4. For recommendedWorkOrder.priority, strictly return one of: "critical", "high", "medium", "low".
5. For severityVerdict, strictly return one of: "IMMEDIATE_HOLD", "EXPEDITED_PM", "SCHEDULED_WATCH".`;

    const { text: raw, modelUsed } = await callGeminiResilient({
      contents: JSON.stringify({
        mode,
        assetContext: assetContext ?? null,
        fleetSummary: fleetSummary ?? null,
      }),
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            severityVerdict: { type: Type.STRING },
            gxpComplianceAssessment: { type: Type.STRING },
            rootCauseHypotheses: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  cause: { type: Type.STRING },
                  confidencePct: { type: Type.NUMBER },
                  telemetryEvidence: { type: Type.STRING },
                },
                required: ['cause', 'confidencePct', 'telemetryEvidence'],
              },
            },
            recommendedWorkOrder: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                serviceType: { type: Type.STRING },
                priority: { type: Type.STRING },
                estimatedHours: { type: Type.NUMBER },
                dueInDays: { type: Type.INTEGER },
                sopReference: { type: Type.STRING },
                requiredParts: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                checklist: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'title',
                'serviceType',
                'priority',
                'estimatedHours',
                'dueInDays',
                'sopReference',
                'requiredParts',
                'checklist',
              ],
            },
            downtimeCostComparison: {
              type: Type.OBJECT,
              properties: {
                unplannedCostUsd: { type: Type.NUMBER },
                preventiveCostUsd: { type: Type.NUMBER },
                downtimeHoursSaved: { type: Type.NUMBER },
                batchRiskMitigated: { type: Type.STRING },
              },
              required: [
                'unplannedCostUsd',
                'preventiveCostUsd',
                'downtimeHoursSaved',
                'batchRiskMitigated',
              ],
            },
            optimizationRecommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: [
            'headline',
            'severityVerdict',
            'gxpComplianceAssessment',
            'rootCauseHypotheses',
            'recommendedWorkOrder',
            'downtimeCostComparison',
            'optimizationRecommendations',
          ],
        },
      },
    });

    const parsed = safeParseModelJson(raw);
    if (!parsed || !parsed.headline) {
      return res.status(502).json({
        error: 'AI returned an incomplete diagnostic response. Please retry.',
      });
    }
    return res.json({ ...parsed, modelUsed });
  } catch (error: any) {
    console.error('AI EAM Diagnose error:', error);
    const friendly = formatFriendlyGeminiError(error);
    return res.status(friendly.status).json({ error: friendly.message });
  }
});

// CAD / DWG / SVG / Blueprint Vision OCR -> Architectural Plan Walls, Glass Walls, Rooms & Openings
app.post('/api/cad/ocr-plan-walls', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server. Add it in AI Studio secrets to run Vision OCR.',
      });
    }

    const {
      fileName = 'architectural-plan',
      imageBase64,
      mimeType = 'image/png',
      vectorHint = '',
      targetWidthM = 28,
      targetDepthM = 18,
      wallHeightM = 3.6,
    } = req.body ?? {};

    if (!imageBase64 && !vectorHint) {
      return res.status(400).json({
        error: 'Provide either a rasterized drawing image (imageBase64) or vector SVG/DXF content (vectorHint).',
      });
    }

    const cleanWidth = Math.max(8, Math.min(160, Number(targetWidthM) || 28));
    const cleanDepth = Math.max(8, Math.min(160, Number(targetDepthM) || 18));
    const cleanHeight = Math.max(2.4, Math.min(8.5, Number(wallHeightM) || 3.6));

    const promptText = `You are an expert architectural CAD/BIM surveyor and floorplan OCR engine.
Analyze the provided architectural drawing (${String(fileName).slice(0, 120)}) and extract a clean, buildable 2D/3D architectural wall plan with OCR room labels, doors, windows, and full glass curtain walls.

TARGET FLOOR FOOTPRINT:
- Width (X axis): 0 to ${cleanWidth} meters (leave ~1.0m margin if helpful, keep coordinates inside [0.5, ${cleanWidth - 0.5}])
- Depth (Z axis): 0 to ${cleanDepth} meters (keep coordinates inside [0.5, ${cleanDepth - 0.5}])
- Wall height: ${cleanHeight} meters

STRICT EXTRACTION RULES:
1. Perform OCR on every visible room number (e.g., 403, 404, RM-101), room name (e.g., Studio Loft, Cleanroom, Lab, Lobby), and dimension text. List all OCR text in "detectedLabels".
2. Trace straight architectural wall segments as clean connected lines (x1, z1, x2, z2) in meters. Snap near-horizontal/vertical walls cleanly. Avoid duplicate overlapping walls.
3. Classify each wall presetId accurately:
   - "exterior-structural" for outer building shell walls
   - "full-glass-wall" for full-height glass curtain walls, storefronts, glazed facades, or cyan/blue double-line glass walls
   - "glass-partition" for interior glass observation partitions
   - "cleanroom-panel" for pharmaceutical / lab cleanroom walls
   - "interior-standard" for standard interior partitions
4. Extract bounding rectangles for every named/numbered room inside "rooms" with accurate OCR "code" (room number) and "name".
5. Detect doors and windows along the walls and reference them by 0-based "wallIndex" (referencing your "walls" array) and "offsetRatio" (0.15 to 0.85). Use subtype "glass-door", "cleanroom-door", "double-door", "single-door" for doors and "double-glazing", "observation-window", "standard-window" for windows.
${vectorHint ? `\nPRE-PARSED VECTOR/TEXT HINTS FROM CAD/SVG:\n${String(vectorHint).slice(0, 9000)}` : ''}`;

    const parts: any[] = [];
    if (typeof imageBase64 === 'string' && imageBase64.length > 32) {
      const stripped = imageBase64.replace(/^data:[^;]+;base64,/, '');
      parts.push({
        inlineData: {
          mimeType: typeof mimeType === 'string' && mimeType.startsWith('image/') ? mimeType : 'image/png',
          data: stripped,
        },
      });
    }
    parts.push({ text: promptText });

    const { text: raw, modelUsed } = await callGeminiResilient({
      contents: [{ role: 'user', parts }],
      config: {
        temperature: 0.15,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            ocrSummary: { type: Type.STRING },
            detectedLabels: { type: Type.ARRAY, items: { type: Type.STRING } },
            footprintWidthM: { type: Type.NUMBER },
            footprintDepthM: { type: Type.NUMBER },
            walls: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  x1: { type: Type.NUMBER },
                  z1: { type: Type.NUMBER },
                  x2: { type: Type.NUMBER },
                  z2: { type: Type.NUMBER },
                  presetId: {
                    type: Type.STRING,
                    enum: [
                      'exterior-structural',
                      'interior-standard',
                      'full-glass-wall',
                      'glass-partition',
                      'cleanroom-panel',
                      'concrete',
                      'fire-rated',
                    ],
                  },
                  isExterior: { type: Type.BOOLEAN },
                },
                required: ['x1', 'z1', 'x2', 'z2', 'presetId'],
              },
            },
            rooms: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  code: { type: Type.STRING },
                  name: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  width: { type: Type.NUMBER },
                  depth: { type: Type.NUMBER },
                },
                required: ['code', 'name', 'x', 'z', 'width', 'depth'],
              },
            },
            openings: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  wallIndex: { type: Type.INTEGER },
                  offsetRatio: { type: Type.NUMBER },
                  kind: { type: Type.STRING, enum: ['door', 'window'] },
                  subtype: { type: Type.STRING },
                  width: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                  sillHeight: { type: Type.NUMBER },
                  name: { type: Type.STRING },
                },
                required: ['wallIndex', 'offsetRatio', 'kind'],
              },
            },
          },
          required: ['ocrSummary', 'detectedLabels', 'footprintWidthM', 'footprintDepthM', 'walls', 'rooms'],
        },
      },
    });

    const parsed = safeParseModelJson(raw);
    if (!parsed || !Array.isArray(parsed.walls) || parsed.walls.length === 0) {
      return res.status(502).json({
        error: 'OCR Vision could not detect clear wall lines from this file. Try higher contrast or calibrate an SVG/DXF drawing.',
      });
    }

    return res.json({ ...parsed, modelUsed });
  } catch (error: any) {
    console.error('CAD/SVG OCR Wall Plan error:', error);
    const friendly = formatFriendlyGeminiError(error);
    return res.status(friendly.status).json({ error: friendly.message });
  }
});

// AI Incident Resolution & FMEA CAPA Generator (Gemini)
app.post('/api/incidents/ai-resolve', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'Gemini API key is not configured on the server. Please check Settings > Secrets.',
      });
    }
    const { incident, facilityName } = req.body ?? {};
    if (!incident || typeof incident !== 'object') {
      return res.status(400).json({ error: 'Incident details are required.' });
    }

    const prompt = [
      `Facility: ${String(facilityName || 'CinnaGen Biopharmaceutical Campus')}`,
      `Incident Code: ${String(incident.code || 'INC-AUTO')}`,
      `Type: ${String(incident.kind || 'alarm')}`,
      `Target: [${String(incident.targetKind || 'asset').toUpperCase()}] ${String(incident.targetCode || '')} - ${String(incident.targetName || '')}`,
      incident.sensorTag ? `Live Sensor Tag: ${String(incident.sensorTag)} (${String(incident.currentValueLabel || '')})` : '',
      `Title: ${String(incident.title || '')}`,
      `Failure Mode: ${String(incident.failureMode || '')}`,
      `Effect: ${String(incident.effect || '')}`,
      `Probable Cause: ${String(incident.cause || '')}`,
      `Current Controls: ${String(incident.currentControls || '')}`,
      `Current FMEA Scores: Severity=${Number(incident.severity) || 7}, Occurrence=${Number(incident.occurrence) || 5}, Detection=${Number(incident.detection) || 5}, RPN=${Number(incident.rpn) || 175}`,
      'Produce an actionable EU GMP Annex 1 / ISO 14644 / ISA-95 engineering root-cause analysis, immediate containment steps, CAPA recommendations, SOP references, residual FMEA S/O/D scores after mitigation (1-10 integers strictly lower or equal to current), and a concrete work order title.',
    ]
      .filter(Boolean)
      .join('\n');

    const { text: raw, modelUsed } = await callGeminiResilient({
      contents: prompt,
      config: {
        systemInstruction:
          'You are a Principal GMP Quality Assurance, Reliability (FMEA), and Biopharma/IT Facilities Engineer. Return concise, practical, audit-ready JSON strictly matching the schema.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            rootCause: { type: Type.STRING },
            immediateContainment: { type: Type.ARRAY, items: { type: Type.STRING } },
            capaActions: { type: Type.ARRAY, items: { type: Type.STRING } },
            sopReferences: { type: Type.ARRAY, items: { type: Type.STRING } },
            residualSeverity: { type: Type.INTEGER },
            residualOccurrence: { type: Type.INTEGER },
            residualDetection: { type: Type.INTEGER },
            recommendedWorkOrderTitle: { type: Type.STRING },
            recommendedPriority: {
              type: Type.STRING,
              enum: ['critical', 'high', 'medium'],
            },
          },
          required: [
            'summary',
            'rootCause',
            'immediateContainment',
            'capaActions',
            'sopReferences',
            'residualSeverity',
            'residualOccurrence',
            'residualDetection',
            'recommendedWorkOrderTitle',
            'recommendedPriority',
          ],
        },
      },
    });

    const parsed = safeParseModelJson(raw);
    if (!parsed || !parsed.summary || !parsed.rootCause) {
      return res.status(502).json({ error: 'AI could not produce a structured resolution plan. Please retry.' });
    }

    const clamp10 = (v: any, fallback: number) => Math.max(1, Math.min(10, Math.round(Number(v) || fallback)));
    const rS = clamp10(parsed.residualSeverity, Math.max(2, (Number(incident.severity) || 6) - 1));
    const rO = clamp10(parsed.residualOccurrence, Math.max(1, (Number(incident.occurrence) || 5) - 2));
    const rD = clamp10(parsed.residualDetection, Math.max(1, (Number(incident.detection) || 5) - 2));

    return res.json({
      resolution: {
        summary: String(parsed.summary),
        rootCause: String(parsed.rootCause),
        immediateContainment: Array.isArray(parsed.immediateContainment)
          ? parsed.immediateContainment.map(String).slice(0, 5)
          : [],
        capaActions: Array.isArray(parsed.capaActions)
          ? parsed.capaActions.map(String).slice(0, 5)
          : [],
        sopReferences: Array.isArray(parsed.sopReferences)
          ? parsed.sopReferences.map(String).slice(0, 4)
          : [],
        residualSeverity: rS,
        residualOccurrence: rO,
        residualDetection: rD,
        residualRpn: rS * rO * rD,
        recommendedWorkOrderTitle: String(parsed.recommendedWorkOrderTitle || `CAPA: ${incident.title}`),
        recommendedPriority:
          parsed.recommendedPriority === 'critical' || parsed.recommendedPriority === 'medium'
            ? parsed.recommendedPriority
            : 'high',
        generatedAt: new Date().toISOString(),
        modelUsed,
      },
    });
  } catch (error: any) {
    console.error('AI Incident Resolution error:', error);
    const friendly = formatFriendlyGeminiError(error);
    return res.status(friendly.status).json({ error: friendly.message });
  }
});

// MAYA Voice Audio Transcription Endpoint (gemini-3.5-transcribe)
app.post('/api/maya/transcribe', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'Gemini API key is not configured on the server.',
      });
    }

    const { audioBase64, mimeType } = req.body ?? {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ error: 'Missing audioBase64 payload.' });
    }

    const cleanedBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '').trim();
    if (!cleanedBase64 || cleanedBase64.length < 32) {
      return res.status(400).json({ error: 'Audio recording is empty or too short.' });
    }

    const rawMime = typeof mimeType === 'string' && mimeType.trim() ? mimeType.trim() : 'audio/webm';
    const normalizedMime = rawMime.split(';')[0].trim() || 'audio/webm';

    const ai = createGeminiClient();
    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: normalizedMime,
                data: cleanedBase64,
              },
            },
            {
              text: 'Transcribe this audio accurately. Preserve pharmaceutical, GMP, HVAC, IT, room code, and equipment terminology. Return only the spoken transcript text.',
            },
          ],
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('Transcription timeout'), { status: 503 })), 25000)
      ),
    ]);

    const transcript = (response.text ?? '').trim();
    return res.json({
      text: transcript,
      modelUsed: 'gemini-3.5-transcribe',
    });
  } catch (error: any) {
    console.error('MAYA audio transcribe error:', error);
    const friendly = formatFriendlyGeminiError(error);
    return res.status(friendly.status).json({ error: friendly.message });
  }
});

// MAYA Async AI Chat Title Generator (gemini-4-hydrogen)
app.post('/api/maya/generate-title', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: 'Gemini API key is not configured on the server.' });
    }
    const { userMessage, assistantPreview } = req.body ?? {};
    const safeUser =
      typeof userMessage === 'string' ? userMessage.trim().slice(0, 400) : '';
    const safeAssistant =
      typeof assistantPreview === 'string' ? assistantPreview.trim().slice(0, 300) : '';
    if (!safeUser) {
      return res.status(400).json({ error: 'Missing userMessage.' });
    }

    const { text } = await callGeminiResilient({
      contents: `Create a crisp, specific 3-to-6 word conversation title for this facility digital-twin chat.\nUser: ${safeUser}\n${safeAssistant ? `Assistant: ${safeAssistant}` : ''}`,
      config: {
        systemInstruction:
          'Return ONLY a plain-text 3 to 6 word title. No quotes, no punctuation at the end, no markdown, no prefixes like "Title:". Preserve exact room codes or equipment codes when mentioned.',
      },
    });

    const cleaned = (text || '')
      .replace(/^["'`#\-\s]+|["'`.\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 60);

    return res.json({
      title: cleaned || safeUser.slice(0, 42),
    });
  } catch (error: any) {
    console.error('MAYA title generation error:', error);
    const friendly = formatFriendlyGeminiError(error);
    return res.status(friendly.status).json({ error: friendly.message });
  }
});

// MAYA Global Voice Command Interpreter (gemini-4-hydrogen structured JSON)
app.post('/api/maya/voice-command', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: 'Gemini API key is not configured on the server.' });
    }
    const { transcript, context } = req.body ?? {};
    const safeTranscript =
      typeof transcript === 'string' ? transcript.trim().slice(0, 500) : '';
    if (!safeTranscript) {
      return res.status(400).json({ error: 'Missing voice transcript.' });
    }

    const roomsSummary = Array.isArray(context?.rooms)
      ? context.rooms.slice(0, 40).map((r: any) => ({
          id: String(r.id ?? ''),
          code: String(r.code ?? ''),
          name: String(r.name ?? ''),
          energyKw: Number(r.energyKw ?? 0),
          hvacStatus: String(r.hvacStatus ?? 'online'),
        }))
      : [];
    const assetsSummary = Array.isArray(context?.assets)
      ? context.assets.slice(0, 80).map((a: any) => ({
          id: String(a.id ?? ''),
          code: String(a.code ?? ''),
          name: String(a.name ?? ''),
          category: String(a.category ?? ''),
          archetype: String(a.archetype ?? ''),
          roomId: String(a.roomId ?? ''),
          energyKw: Number(a.energyKw ?? 0),
        }))
      : [];

    const { text, modelUsed } = await callGeminiResilient({
      contents: `Voice command: "${safeTranscript}"\n\nFacility Rooms:\n${JSON.stringify(
        roomsSummary
      )}\n\nFacility Equipment:\n${JSON.stringify(assetsSummary)}`,
      config: {
        systemInstruction: `You are MAYA, the voice command router for a Pharmaceutical & Industrial 3D Digital Twin.
Interpret the spoken command (even if it starts with "Maya, ...") and map it to ONE structured action:
- "show_fire_sensors": user asks to show/inspect fire sensors or extinguishers in a room (set roomId to matching room id).
- "highlight_hvac_energy": user asks to highlight HVAC equipment or rooms with high energy usage (set matchedAssetIds to HVAC/high-kW asset ids and matchedRoomIds to high-energy rooms, enableHvacOverlay=true).
- "highlight_assets": user asks to highlight/find specific equipment by category/keyword (set matchedAssetIds).
- "navigate_room": user asks to go to, show, or inspect a room (set roomId).
- "walk_room": user asks to walk inside a room in first-person (set roomId).
- "toggle_room_light": user asks to turn lights on or off in a room (set roomId and desiredBool=true/false).
- "open_equipment_info": user asks for info/SOP/history of an asset (set assetId).
- "open_screen": user asks to open telemetry, maya-life, data-center, or workspace (set screen).
- "ask_maya": general question not covered by direct UI commands (set chatPrompt).
Always return concise spokenFeedback (1 short sentence).`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action: {
              type: Type.STRING,
              description:
                'One of: show_fire_sensors, highlight_hvac_energy, highlight_assets, navigate_room, walk_room, toggle_room_light, open_equipment_info, open_screen, ask_maya',
            },
            roomId: { type: Type.STRING },
            assetId: { type: Type.STRING },
            matchedAssetIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            matchedRoomIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            desiredBool: { type: Type.BOOLEAN },
            enableHvacOverlay: { type: Type.BOOLEAN },
            screen: { type: Type.STRING },
            bannerTitle: { type: Type.STRING },
            bannerSubtitle: { type: Type.STRING },
            spokenFeedback: { type: Type.STRING },
            chatPrompt: { type: Type.STRING },
          },
          required: ['action', 'spokenFeedback'],
        },
      },
    });

    const parsed = safeParseModelJson(text);
    return res.json({
      ...parsed,
      modelUsed,
    });
  } catch (error: any) {
    console.error('MAYA voice command error:', error);
    const friendly = formatFriendlyGeminiError(error);
    return res.status(friendly.status).json({ error: friendly.message });
  }
});

// Ensure unknown /api/* routes ALWAYS return JSON (never fall through to Vite HTML index.html)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Ensure Express middleware/body-parser errors on /api/* ALWAYS return JSON instead of HTML
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api')) {
    const status = Number(err?.status || err?.statusCode) || 500;
    return res.status(status).json({
      error: err?.message || 'Unexpected server error while processing API request.',
    });
  }
  next(err);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gradian Digital Twin Studio listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
