# MAYA Cinematic v3.0 — Gradian.me web character

## 1. Start here

Open `index.html` directly in a desktop browser. The model, textures, GPU renderer and Canvas 2D software fallback are embedded in the page. No internet, CDN, npm install, remote import, or separate asset request is required. If local scripts are blocked by enterprise policy, serve the extracted folder with `python -m http.server 8080` and open `http://localhost:8080/`.

Select the operational state and the independent facial expression. Drag to orbit; scroll to zoom; Reset view restores the smaller default framing. MAYA occupies approximately 53% of the stage height at the default desktop camera distance. Reduced motion freezes each state in its representative pose.

## 2. Revision details

| Feature | v3 implementation |
| --- | --- |
| Thinking | Two articulated arm segments, elbow-out IK pose anchored to the tilted head's chin. Both `thinking` and `analyze` use it. |
| Face | Opaque texture directly on the head's UV mesh. No separate decal geometry; no lip or mouth in neutral, thinking, curious or searching. Other emotions have small, rounded, expressive mouths only where appropriate. |
| Eyes and cheeks | Round dark eyes and soft blush with high-resolution 640 x 384 expression tiles; smooth bilinear texture sampling. |
| Animation | Continuous analytic motion sampled at 12 keyframes per second in active clips; quaternion interpolation and 520 ms smoothstep body transitions; 180 ms facial crossfades. |
| Idle | Eight-second loop, nearly motionless head and torso, occasional blink, no symbol. |
| Question | A purple question mark floats above the head. It remains the authoritative icon even with an expression override. |
| Other symbols | Fifteen shared, optional state and expression symbols. Their appearance and disappearance are eased; no permanent three-dot badge. |
| Appearance | Matte skin and cloth, high roughness, subtle cool fill and soft directional lighting, longer navy-red polo, collar leaves and placket, exact supplied logo raster resized and embedded. |
| Viewer | Self-contained HTML. WebGL2 path targets display refresh for active states; idle draws less frequently. Software fallback uses a lower frame-rate target. |

### Asset size / performance

- GLB: 315,276 bytes (308 KiB); 46 nodes; 30 unique meshes; 12,346 triangle instances including the hidden icon quad. Approximately 12.3K visible in idle.
- 21 native named body clips. 21 user-facing expressions plus one internal blink. 15 optional symbols.
- 3 embedded PNG textures: original logo, opaque facial atlas, transparent symbol atlas. The facial atlas is 3200 x 1920 (5 x 5 cells) and expands to about 23.4 MiB as uncompressed RGBA; packed GLB size is not GPU memory use. The Three.js controller uses a separate small per-instance face texture (~0.94 MiB RGBA).
- Standard glTF 2.0; no Draco, Meshopt, or texture decoder dependencies. No external textures. Model bounds are approximately 1.24 x 2.16 x 0.98 glTF units. Use a parent scale or camera framing to control physical/display size; the smaller preview does not destroy geometry quality.
- v2 was 126 KB. This version intentionally spends more bytes on smoother geometry, elbows and facial fidelity while staying below v1's ~511 KB. It is a stylized matte procedural mascot, not a photorealistic character sculpt or cloth simulation.

## 3. State and symbol contracts

Each named clip is an animation in the GLB. The runtime controller adds the expression, symbol, state transition and automatic return behavior.

| State | Expression | Symbol | Duration | Playback |
| --- | --- | --- | ---: | --- |
| idle | neutral | none | 8 s | loop |
| working | neutral | dots | 3 s | loop |
| thinking | thinking | none | 4 s | loop |
| searching | curious | search | 3.2 s | loop |
| approval | approval | thumb | 2.6 s | loop |
| question | curious | question | 3.6 s | loop |
| error | error | alert | 2.5 s | loop |
| finished | finished | check | 2.2 s | once, hold |
| ratelimit | concerned | clock | 4 s | loop |
| sleeping | sleeping | sleep | 7 s | loop |
| dizzy | dizzy | spiral | 3 s | loop |
| chat | happy | dots | 3 s | loop |
| wave | happy | none | 2.8 s | once, return to idle |
| analyze | thinking | none | 4 s | loop |
| present | confident | none | 3.6 s | loop |
| create | joyful | idea | 3.4 s | loop |
| organize | neutral | none | 4 s | loop |
| teach | confident | none | 3.4 s | loop |
| support | happy | none | 3.2 s | loop |
| celebrate | joyful | confetti | 2.6 s | once, return to idle |
| laptop | neutral | none | 3.5 s | loop |

Independent expressions: `neutral`, `happy`, `joyful`, `wink`, `surprised`, `thinking`, `curious`, `confident`, `love`, `proud`, `concerned`, `confused`, `annoyed`, `tired`, `sleeping`, `dizzy`, `error`, `finished`, `approval`, `searching`, `yawn`.

Expression symbols: `love -> heart`, `proud/joyful -> stars`, `surprised -> exclaim`, `confused/dizzy -> spiral`, `annoyed -> anger`, `sleeping/yawn -> sleep`, `error -> alert`, `finished -> check`, `approval -> thumb`, `searching -> search`, `curious -> question`. All other expressions have no independent symbol. Question state has priority; an explicit expression with a symbol then takes priority over the state symbol. Otherwise the state's symbol remains. For a completely clean neutral head, select `idle` and `neutral`.

`blink` is an internal frame. Alias names accepted by the Three.js controller: `work`, `think`, `rate_limit`, `rate-limit`, `none`.

## 4. Three.js integration

The standalone viewer is dependency-free; the production adapter uses the application's existing Three.js runtime. Install `three` if your app does not already have it. Copy the GLB to `public/models/maya.glb` and the adapter to your source directory.

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MayaController } from './maya-controller.mjs';

const gltf = await new GLTFLoader().loadAsync('/models/maya.glb');
const mayaGroup = new THREE.Group();
mayaGroup.scale.setScalar(0.35); // example physical scale; tune your own scene
mayaGroup.add(gltf.scene);
scene.add(mayaGroup);
const maya = new MayaController(gltf, {
  fade: 0.52, faceFade: 0.18,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  autoReturn: true,
  onStateChange: state => console.log(state),
  onFinished: state => console.log('done:', state),
});
let last = performance.now();
renderer.setAnimationLoop(now => {
  maya.update((now - last) / 1000);
  last = now;
  renderer.render(scene, camera);
});

maya.setState('thinking');
maya.setState('question');
maya.setExpression('love');
maya.setState('working', { expression: 'confident', fade: 0.55 });
maya.setState('wave', { restart: true });
maya.setReducedMotion(true);
// on unmount: maya.dispose(); scene.remove(mayaGroup);
```

For matte studio lighting use a soft large-area-light approximation (directional key + hemisphere ambient + low-intensity fill), shadows when appropriate, sRGB output and filmic tone mapping. No metallic material is required. For a small overlay viewport render at DPR <= 1.5 (or 2 on stronger hardware), with CSS sizing around 160–300 px, and allow the whole character plus floating sign to fit in the camera. Do not use multiple WebGL contexts for multiple avatars if they can share a canvas. Disable render work when hidden and avoid rebuilding GLTF on state changes.

### React Three Fiber / Next.js

```jsx
'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { MayaController } from './maya-controller.mjs';

export default function Maya({ state = 'idle', expression, reducedMotion = false, scale = 0.35 }) {
  const source = useGLTF('/models/maya.glb');
  const scene = useMemo(() => source.scene.clone(true), [source.scene]);
  const ctrl = useRef(null);
  useEffect(() => {
    const c = new MayaController({scene, animations: source.animations});
    ctrl.current = c;
    return () => { c.dispose(); ctrl.current = null; };
  }, [scene, source.animations]);
  useEffect(() => { ctrl.current?.setState(state, {expression}); }, [state, scene]);
  useEffect(() => { if (expression) ctrl.current?.setExpression(expression); }, [expression, scene]);
  useEffect(() => { ctrl.current?.setReducedMotion(reducedMotion); }, [reducedMotion, scene]);
  useFrame((_, dt) => ctrl.current?.update(dt));
  return <group scale={scale}><primitive object={scene} dispose={null}/></group>;
}
useGLTF.preload('/models/maya.glb');
```

Render this component inside `<Canvas>`; the controller is client-side because its per-instance face crossfade uses Canvas 2D. The `useGLTF` cache may share geometry and source textures. Each avatar must have a separate cloned scene hierarchy; the controller clones its head and icon materials and owns only those cloned resources. The parent application owns renderer, cached assets and scene cleanup.

### Application events

```js
const map = {
  'request.started': 'thinking', 'tool.started': 'working',
  'search.started': 'searching', 'input.required': 'question',
  'approval.required': 'approval', 'response.streaming': 'chat',
  'response.completed': 'finished', 'request.failed': 'error',
  'request.rate_limited': 'ratelimit', 'session.inactive': 'idle',
};
function onAgentEvent(event) {
  const state = map[event.type];
  if (state) maya.setState(state);
}
```

Treat application state as authoritative, not generated text; resolve competing state priorities in the app. Repeated streaming tokens must not restart the same state. Use `restart: true` only to deliberately replay an action. One-shot actions `wave` and `celebrate` return to idle by default; `finished` holds until changed.

## 5. Framework-independent asset contract

- Root `MAYA_Root`, front +Z, up +Y. Animated nodes: `TorsoPivot`, `HeadPivot`, `Arm_L`, `Arm_R`, `Elbow_L`, `Elbow_R`. Animation channels target local quaternions. Native GLB players can play named clips directly, but they do not implement the semantic state machine.
- `FaceAtlas` is the head mesh itself, not an overlay. Default UVs sample the neutral cell in a 5x5 atlas. Tile offset is `(index % 5 / 5, floor(index / 5) / 5)`. Keep GLTF UV origin / texture flip conventions; filter linearly without mipmaps. For a cropped cell texture, multiply UV by 5 in each axis (or texture repeat 5,5). Blend cells with easing for face transitions. Never redraw a floating mouth mesh over the head.
- `StatusIcon` is the hidden parent pivot. `StatusIconAtlas` is a two-sided alpha-masked quad; default UVs sample the first of 4x4 cells. Set texture offset `(index % 4 / 4, floor(index / 4) / 4)`. Animate pivot scale from 0 to 1 with smoothstep and hide between atlas swaps. Use the symbol order and mappings in `maya-manifest.json`.
- Body transitions: snapshot all six current quaternions, sample the next clip, then slerp using `smoothstep(t)` with t progressing from 0 to 1 over 0.52 seconds. This supports rapid state changes without a pose reset. Loop clips have continuous periodic keyframes; use quaternion interpolation, not Euler interpolation. Face crossfade is 0.18 seconds.
- `window.maya` in the standalone demo exposes `setState(name)`, `setExpression(name)`, and read-only `state`, `expression`, `icon`, and `renderer`. Browser buttons use the same functions.

## 6. Package contents and rebuild

- `maya.glb` — deployable model.
- `index.html` — fully self-contained offline demo.
- `maya-controller.mjs` — Three.js adapter.
- `maya-manifest.json` — machine-readable state, face and symbol contract.
- `preview-states.jpg` — images captured from the actual viewer, not concept artwork.
- `build_maya.py`, `viewer.js`, `index-template.html`, `Gradian-Logo-darkmode-min.png` — reproducible source.

Install Python dependencies: `pip install numpy scipy Pillow`. Build using `python build_maya.py`. The icon generator uses system DejaVuSans-Bold.ttf; adapt `fontpath` if needed. Regenerate the standalone HTML from its template:

```python
from pathlib import Path
from base64 import b64encode
p = Path('.')
(p/'index.html').write_text((p/'index-template.html').read_text()
    .replace('__ASSET__', b64encode((p/'maya.glb').read_bytes()).decode())
    .replace('__VIEWER__', (p/'viewer.js').read_text()))
```

## 7. Validation and limitations

- Verified binary header and chunk lengths, all accessor ranges and finite values, all 21 animation tracks and increasing timestamps, node references and keyframe counts; successfully imported with trimesh.
- Tested actual embedded asset in Chromium offline using the Canvas 2D software renderer. Confirmed first render, thinking pose, question symbol, working dots, search, approval, error, sleep, dizzy and independent love expression; wave returned to idle. Screenshots are actual browser renders. No page-script errors in these tests.
- Both JS files pass Node syntax checks. WebGL2 hardware performance, browser direct file navigation under enterprise policy, and real Three.js/R3F runtime integration were not verified in this environment. No claim of guaranteed 60 FPS; software rendering is slower and less polished than hardware rendering. Test on the target device.
- State/mood symbols and face crossfades require the included controller (or equivalent implementation); a generic GLB viewer displays the neutral face and hidden icon. Physical laptop, tablet, headset, etc. are not included to maintain a small asset. Stylized matte design is not a photorealistic sculpt. Logo is the supplied raster artwork resampled, not recreated as text or a vector.
