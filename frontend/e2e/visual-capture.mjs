/**
 * Capturas para revisão visual (não é um teste de aprovação): percorre o fluxo até a plataforma e fotografa
 * cada ambiente de vários ângulos e distâncias (hangar da sonda, hangar de lançadores, trajetória e Sistema
 * Solar no planejamento, tela inicial e plataforma). Mede os FPS de cada vista e registra erros do console.
 * Uso: npm run build && node e2e/visual-capture.mjs   Variáveis: CAPTURE_DIR, E2E_MISSION, E2E_URL.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.CAPTURE_DIR ?? join(here, 'artifacts', 'visual');
mkdirSync(out, { recursive: true });
const mission = process.env.E2E_MISSION ?? 'jupiter-system';
/** Seções a capturar (padrão: todas): start, hangar, vehicle, planning, pad. */
const only = new Set((process.env.CAPTURE_ONLY ?? 'start,hangar,vehicle,planning,pad').split(','));

let server = null;
let base = process.env.E2E_URL;
if (!base) {
  base = 'http://127.0.0.1:4174';
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { cwd: join(here, '..'), stdio: 'pipe', detached: true });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite preview não iniciou')), 30000);
    server.stdout.on('data', (d) => { if (String(d).includes('4174')) { clearTimeout(t); resolve(); } });
  });
}
const errors = [];
const report = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|\/api\//.test(m.text())) errors.push(`console: ${m.text()}`); if (process.env.E2E_DEBUG) console.log(`  [${m.type()}] ${m.text()}`); });

/** Ajusta a câmera ativa (ArcRotate) e espera alguns quadros. */
const cam = async (o) => {
  await page.evaluate((o) => {
    const c = globalThis.__sceneManager.controller.scene.activeCamera;
    if (o.target) c.setTarget(new c.target.constructor(...o.target));
    if (o.alpha !== undefined) c.alpha = o.alpha;
    if (o.beta !== undefined) c.beta = o.beta;
    if (o.radius !== undefined) c.radius = o.radius;
  }, o);
  await page.waitForTimeout(o.wait ?? 2500);
};
/** No SwiftShader a qualidade cai em degraus (2→1→0) nos primeiros segundos; cada degrau redimensiona o canvas
 * e o quadro seguinte demora, então a captura espera a qualidade estabilizar para não pegar um quadro vazio. */
const settle = async () => {
  await page.waitForFunction(() => globalThis.__sceneManager.status.quality === 0, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
};
const fps = () => page.evaluate(() => globalThis.__sceneManager.status.fps);
const shot = async (name, section) => {
  if (section && !only.has(section)) return;
  await page.screenshot({ path: join(out, `${name}.png`) });
  const f = await fps();
  report.push({ name, fps: f });
  console.log(`  ${name} (${f} FPS)`);
};

try {
  await page.goto(base);
  await page.getByTestId('player-name').waitFor();
  await page.waitForTimeout(6000);
  if (only.has('start')) await shot('00-tela-inicial');
  await page.getByTestId('player-name').fill('Captura');
  await page.getByTestId('start-button').click();
  await page.getByTestId(`mission-${mission}`).click();
  await page.getByTestId('assist-iniciante').click();
  await page.getByTestId('confirm-mission').click();
  await page.getByTestId('catalog-search').waitFor();
  await page.getByTestId('apply-suggestion').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="installed-list"] li').length > 5);
  await page.waitForTimeout(9000);
  await settle();
  await shot('01-hangar-geral', 'hangar');
  if (only.has('hangar')) {
  await cam({ alpha: -0.6, beta: 1.05, radius: 18 });
  await shot('02-hangar-amplo', 'hangar');
  await cam({ alpha: -2.4, beta: 1.32, radius: 22 });
  await shot('03-hangar-lateral', 'hangar');
  await cam({ alpha: -1.2, beta: 1.2, radius: 7.5 });
  await shot('04-sonda-perto', 'hangar');
  await cam({ alpha: -1.9, beta: 1.45, radius: 5 });
  await shot('05-sonda-detalhe', 'hangar');
  await cam({ target: [-5.2, 2.5, 1.2], alpha: -0.9, beta: 1.25, radius: 6 });
  await shot('06-braco-robotico', 'hangar');
  }
  await page.getByTestId('to-vehicle').click();
  const ref = { 'leo-climate': 'falcon-9', 'lunar-he3': 'falcon-9', 'jupiter-system': 'falcon-heavy' }[mission];
  await page.getByTestId(`vehicle-${ref}`).click();
  await page.getByTestId('select-vehicle').click();
  await page.waitForTimeout(5000);
  await shot('07-hangar-lancadores', 'vehicle');
  await page.getByTestId('to-planning').click();
  await page.getByTestId('stat-dv').waitFor();
  if (await page.getByTestId('snap-window').isVisible().catch(() => false)) await page.getByTestId('snap-window').click();
  await page.waitForTimeout(6000);
  await shot('08-trajetoria', 'planning');
  for (const [f, n] of [['system', '09-sistema-solar'], ['destination', '10-destino']]) {
    await page.evaluate((f) => globalThis.__sceneManager.controller.setFocus(f), f);
    await page.waitForTimeout(6000);
    await shot(n, 'planning');
  }
  await page.evaluate(() => globalThis.__sceneManager.controller.setFocus('trajectory'));
  await page.waitForTimeout(5000);
  await page.evaluate(() => { const c = globalThis.__sceneManager.controller.scene.activeCamera; c.radius *= 0.08; });
  await page.waitForTimeout(3000);
  await shot('11-trajetoria-zoom', 'planning');
  if (only.has('pad')) {
  await page.getByTestId('to-briefing').click();
  await page.getByTestId('briefing-status').waitFor();
  await page.waitForTimeout(3000);
  await page.getByTestId('to-launch').click();
  await page.waitForTimeout(12000);
    await shot('12-plataforma-geral');
  for (const [c, n] of [['tracking', '13-plataforma-rastreio'], ['cinematic', '14-plataforma-cinematica'], ['externalDown', '15-plataforma-externa']]) {
    await page.getByTestId(`camera-${c}`).click();
    await page.waitForTimeout(5000);
    await shot(n);
  }
  }
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ report, errors }, null, 2));
  if (errors.length) console.error(`erros no console:\n${errors.join('\n')}`); else console.log('sem erros no console');
  await browser.close();
  if (server) try { process.kill(-server.pid); } catch { /* já encerrado */ }
}
