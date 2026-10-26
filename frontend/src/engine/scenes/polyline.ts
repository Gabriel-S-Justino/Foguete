/**
 * Linhas de órbita e trajetória com espessura constante em pixels e borda suavizada no shader.
 *
 * Por que trocar o LinesMesh do Babylon: ele desenha com GL_LINES (1 px, sem suavização) e o pós-processamento
 * renderiza numa textura sem multiamostragem, então as curvas ficavam serrilhadas e "piscavam" ao girar a câmera.
 * Aqui cada segmento vira um quadrilátero voltado para a tela, com junções em meia-esquadria (miter) e uma
 * faixa de 1 px de transição na borda (antisserrilhamento analítico, independente do MSAA). O vértice que
 * fica atrás da câmera é trazido para o plano da câmera ao longo do próprio segmento, para a espessura não
 * "explodir" quando a curva passa por trás do observador.
 *
 * Cada vértice leva o instante da trajetória (s): o trecho já percorrido (t ≤ agora) é desenhado cheio e o
 * trecho planejado mais fino e translúcido, sem refazer a geometria (só um uniform muda por quadro).
 */
import { Color3, Constants, Effect, Mesh, type Scene, ShaderMaterial, VertexBuffer, VertexData } from '@babylonjs/core';
import type { V3 } from '../orbital-mechanics/kepler';

const VERT = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 prevPos;
attribute vec3 nextPos;
attribute float side;
attribute float tParam;
uniform mat4 world;
uniform mat4 viewProjection;
uniform vec2 resolution;
uniform float widthDone;
uniform float widthPlan;
uniform float tNow;
varying float vSide;
varying float vHalf;
varying float vT;
varying float vFade;

vec4 clipOf(vec3 p) { return viewProjection * world * vec4(p, 1.0); }
// Ponto atrás da câmera: desliza pelo segmento até ficar logo à frente dela (interpolação linear em clip space)
vec4 pullFront(vec4 a, vec4 b) {
  float eps = 1e-3;
  if (a.w >= eps || b.w < eps) return a;
  return mix(a, b, (eps - a.w) / (b.w - a.w));
}
void main() {
  vec4 c = clipOf(position);
  vec4 p = clipOf(prevPos);
  vec4 n = clipOf(nextPos);
  c = pullFront(c, n.w > p.w ? n : p);
  p = pullFront(p, c);
  n = pullFront(n, c);
  vec2 half_res = resolution * 0.5;
  vec2 sc = c.xy / c.w * half_res;
  vec2 sp = p.xy / p.w * half_res;
  vec2 sn = n.xy / n.w * half_res;
  vec2 d1 = sc - sp, d2 = sn - sc;
  float l1 = length(d1), l2 = length(d2);
  d1 = l1 > 1e-4 ? d1 / l1 : (l2 > 1e-4 ? d2 / l2 : vec2(1.0, 0.0));
  d2 = l2 > 1e-4 ? d2 / l2 : d1;
  vec2 tangent = normalize(d1 + d2 + vec2(1e-6, 0.0));
  vec2 normal = vec2(-tangent.y, tangent.x);
  float miter = 1.0 / max(0.35, dot(normal, vec2(-d1.y, d1.x)));
  // Linhas mais finas que ~1,3 px de buffer ficam com a largura mínima e perdem opacidade na mesma proporção
  // (sem isso, com a resolução reduzida, a linha sub-pixel virava uma sequência de contas)
  float wReq = tParam <= tNow ? widthDone : widthPlan;
  float w = max(wReq, 1.3) * 0.5;
  vFade = min(1.0, wReq / 1.3);
  // +1 px para a borda suavizada
  float extent = (w + 1.0) * miter;
  c.xy += normal * side * extent / half_res * c.w;
  gl_Position = c;
  vSide = side * (w + 1.0);
  vHalf = w;
  vT = tParam;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 colorDone;
uniform vec3 colorPlan;
uniform float alphaDone;
uniform float alphaPlan;
uniform float tNow;
varying float vSide;
varying float vHalf;
varying float vT;
varying float vFade;
void main() {
  bool done = vT <= tNow;
  // Cobertura do pixel pela faixa de largura 2·vHalf (transição de 1 px na borda)
  float cover = clamp(vHalf + 0.5 - abs(vSide), 0.0, 1.0);
  float a = cover * vFade * (done ? alphaDone : alphaPlan);
  if (a < 0.003) discard;
  gl_FragColor = vec4(done ? colorDone : colorPlan, a);
}`;

export interface PolylineStyle {
  color: Color3;
  /** Cor do trecho planejado (padrão: a mesma). */
  planColor?: Color3;
  /** Largura em pixels CSS do trecho percorrido e do planejado. */
  widthDone?: number;
  widthPlan?: number;
  alphaDone?: number;
  alphaPlan?: number;
}

export interface Polyline {
  mesh: Mesh;
  material: ShaderMaterial;
  /** Substitui os pontos (e os instantes de cada um). Reaproveita os buffers quando o número de pontos não muda. */
  setPoints(points: V3[], times?: number[]): void;
  /** Instante atual (s): vértices com t ≤ tNow usam o estilo "percorrido". */
  setTime(t: number): void;
  setStyle(s: Partial<PolylineStyle>): void;
  dispose(): void;
}

function register(): void {
  if (Effect.ShadersStore.polylineVertexShader) return;
  Effect.ShadersStore.polylineVertexShader = VERT;
  Effect.ShadersStore.polylineFragmentShader = FRAG;
}

/** Linha com largura em pixels. Os pontos são relativos à posição da malha (ponha a malha no centro do corpo). */
export function createPolyline(scene: Scene, name: string, style: PolylineStyle): Polyline {
  register();
  const mesh = new Mesh(name, scene);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  const mat = new ShaderMaterial(`${name}-mat`, scene, { vertex: 'polyline', fragment: 'polyline' }, {
    attributes: ['position', 'prevPos', 'nextPos', 'side', 'tParam'],
    uniforms: ['world', 'viewProjection', 'resolution', 'widthDone', 'widthPlan', 'tNow', 'colorDone', 'colorPlan', 'alphaDone', 'alphaPlan'],
    needAlphaBlending: true,
  });
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.alphaMode = Constants.ALPHA_COMBINE;
  let st: Required<PolylineStyle> = { widthDone: 2, widthPlan: 1.4, alphaDone: 0.95, alphaPlan: 0.55, ...style, planColor: style.planColor ?? style.color };
  const applyStyle = () => {
    mat.setColor3('colorDone', st.color);
    mat.setColor3('colorPlan', st.planColor ?? st.color);
    mat.setFloat('alphaDone', st.alphaDone);
    mat.setFloat('alphaPlan', st.alphaPlan);
  };
  applyStyle();
  mat.setFloat('tNow', 1e30);
  mat.onBindObservable.add(() => {
    const engine = scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    const k = canvas && canvas.clientWidth > 0 ? engine.getRenderWidth() / canvas.clientWidth : 1;
    const eff = mat.getEffect();
    if (!eff) return;
    eff.setFloat2('resolution', engine.getRenderWidth(), engine.getRenderHeight());
    eff.setFloat('widthDone', st.widthDone * k);
    eff.setFloat('widthPlan', st.widthPlan * k);
  });
  mesh.material = mat;
  let count = -1;

  const setPoints = (pts: V3[], times?: number[]) => {
    const n = pts.length;
    if (n < 2) { mesh.setEnabled(false); return; }
    const pos = new Float32Array(n * 6), prev = new Float32Array(n * 6), next = new Float32Array(n * 6);
    const side = new Float32Array(n * 2), tp = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i]!, a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
        prev[o] = a[0]; prev[o + 1] = a[1]; prev[o + 2] = a[2];
        next[o] = b[0]; next[o + 1] = b[1]; next[o + 2] = b[2];
        side[i * 2 + k] = k === 0 ? -1 : 1;
        tp[i * 2 + k] = times ? times[i]! : -1e30;
      }
    }
    if (n === count) {
      mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
      mesh.updateVerticesData('prevPos', prev);
      mesh.updateVerticesData('nextPos', next);
      mesh.updateVerticesData('tParam', tp);
    } else {
      const idx = new Uint32Array((n - 1) * 6);
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2;
        idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
      }
      const vd = new VertexData();
      vd.positions = pos;
      vd.indices = idx;
      vd.applyToMesh(mesh, true);
      mesh.setVerticesData('prevPos', prev, true, 3);
      mesh.setVerticesData('nextPos', next, true, 3);
      mesh.setVerticesData('side', side, false, 1);
      mesh.setVerticesData('tParam', tp, true, 1);
      count = n;
    }
    mesh.setEnabled(true);
  };

  return {
    mesh,
    material: mat,
    setPoints,
    setTime(t) { mat.setFloat('tNow', t); },
    setStyle(s) { st = { ...st, ...s, planColor: s.planColor ?? s.color ?? st.planColor }; applyStyle(); },
    dispose() { mesh.dispose(false, true); },
  };
}
