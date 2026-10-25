/**
 * Teste ponta a ponta das câmeras e do zoom do lançamento (Playwright + Chromium).
 * Verifica que cada câmera tem posição própria, que o zoom não é desfeito no quadro seguinte e que as
 * câmeras externas acompanham o foguete; grava capturas de tela em e2e/artifacts/cameras-*.png.
 * Uso: npm run build && npm run test:e2e:cameras   (E2E_URL usa um servidor já em execução; E2E_MISSION muda a missão)
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const artifacts = join(here, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const mission = process.env.E2E_MISSION ?? 'leo-climate';

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
const browser = await chromium.launch({ headless: !process.env.E2E_HEADED, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|\/api\//.test(m.text())) errors.push(`console: ${m.text()}`); });

const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { await page.screenshot({ path: join(artifacts, `cameras-fail-${name.replace(/\W+/g, '-')}.png`) }); throw new Error(`${name}: ${e.message}`); }
};
const shot = (n) => page.screenshot({ path: join(artifacts, `cameras-${n}.png`) });
const info = () => page.evaluate(() => globalThis.__launchPad.cameraInfo());
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const camera = async (c) => { await page.getByTestId(`camera-${c}`).click(); await page.waitForTimeout(1500); return info(); };

try {
  await step('preparar a missão até a plataforma', async () => {
    await page.goto(base);
    await page.getByTestId('player-name').fill('Equipe Câmeras');
    await page.getByTestId('start-button').click();
    await page.getByTestId(`mission-${mission}`).click();
    await page.getByTestId('assist-iniciante').click();
    await page.getByTestId('confirm-mission').click();
    await page.getByTestId('apply-suggestion').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="installed-list"] li').length > 5);
    await page.getByTestId('to-vehicle').click();
    const ref = { 'leo-climate': 'falcon-9', 'lunar-he3': 'falcon-9', 'jupiter-system': 'falcon-heavy' }[mission];
    await page.getByTestId(`vehicle-${ref}`).click();
    await page.getByTestId('select-vehicle').click();
    await page.getByTestId('to-planning').click();
    await page.getByTestId('stat-dv').waitFor();
    if (await page.getByTestId('snap-window').isVisible().catch(() => false)) await page.getByTestId('snap-window').click();
    await page.getByTestId('to-briefing').click();
    await page.getByTestId('briefing-status').waitFor();
    await page.getByTestId('to-launch').click();
    await page.waitForFunction(() => Boolean(globalThis.__launchPad), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot('01-geral-plataforma');
  });

  await step('cada câmera tem posição própria', async () => {
    const pos = {};
    for (const c of ['overview', 'tracking', 'cinematic', 'externalDown', 'externalUp']) {
      const i = await camera(c);
      assert(i.mode === c, `modo ativo ${i.mode} ≠ ${c}`);
      pos[c] = i.position;
      await shot(`02-${c}-plataforma`);
    }
    const names = Object.keys(pos);
    for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
      assert(dist(pos[names[a]], pos[names[b]]) > 1, `${names[a]} e ${names[b]} estão na mesma posição`);
    }
    assert(dist(pos.externalDown, pos.externalUp) > 10, 'câmeras externas deveriam estar em alturas diferentes do estágio');
  });

  await step('zoom persiste entre quadros', async () => {
    for (const c of ['overview', 'tracking', 'externalDown']) {
      const before = await camera(c);
      await page.getByTestId('zoom-in').click();
      await page.getByTestId('zoom-in').click();
      await page.waitForTimeout(1200);
      const after = await info();
      assert(after.zoom > before.zoom * 1.9, `${c}: fator de zoom não aumentou (${before.zoom} → ${after.zoom})`);
      const changed = c === 'tracking' ? dist(after.position, before.position) > 5 : after.fov < before.fov * 0.8;
      assert(changed, `${c}: o zoom foi desfeito (fov ${before.fov.toFixed(3)} → ${after.fov.toFixed(3)})`);
    }
    // Roda do mouse também altera o zoom
    await camera('tracking');
    const z0 = (await info()).zoom;
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(500);
    assert((await info()).zoom > z0, 'roda do mouse não aproximou');
  });

  await step('lançamento com câmeras', async () => {
    await page.getByTestId('start-procedures').click();
    await page.waitForFunction(() => /PRONTO|HOLD/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 20000 });
    for (let i = 0; i < 5 && await page.getByTestId('confirm-launch').isDisabled(); i++) {
      if (await page.getByTestId('hold').isEnabled()) await page.getByTestId('hold').click();
      await page.waitForTimeout(7000);
    }
    await camera('overview');
    await page.getByTestId('confirm-launch').click();
    await page.waitForFunction(() => /EM VOO/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot('03-geral-decolagem');
    const down0 = await camera('externalDown');
    await shot('04-externa-baixo-decolagem');
    await page.waitForTimeout(1500);
    const down1 = await info();
    assert(down1.position[1] > down0.position[1], 'câmera externa não acompanhou a subida do foguete');
    await camera('externalUp');
    await shot('05-externa-cima-decolagem');
    await camera('tracking');
    await page.getByTestId('warp-10').click();
    await page.waitForTimeout(4000);
    await shot('06-rastreio-subida');
    await camera('cinematic');
    await page.waitForTimeout(1500);
    await shot('07-cinematica');
    // Separação do primeiro estágio vista pela câmera externa
    await page.waitForFunction(() => /separa/i.test(document.querySelector('[data-testid="terminal"]')?.textContent ?? ''), null, { timeout: 120000 });
    await page.getByTestId('warp-1').click();
    await camera('externalDown');
    await page.waitForTimeout(2500);
    await shot('08-externa-baixo-separacao');
    await camera('externalUp');
    await page.waitForTimeout(800);
    await shot('09-externa-cima-separacao');
    await camera('overview');
    await shot('10-geral-longa-distancia');
    await page.getByTestId('warp-20').click();
    await page.waitForFunction(() => /ÓRBITA|FALHA|ABORT/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 240000 });
    await camera('externalDown');
    await page.waitForTimeout(1000);
    await shot('11-externa-baixo-final');
    await camera('tracking');
    await page.waitForTimeout(1000);
    await shot('12-rastreio-final');
    console.log(`  estado final: ${await page.getByTestId('launch-state').textContent()}`);
  });
  if (errors.length) throw new Error(`erros no console:\n${errors.join('\n')}`);
  console.log('E2E de câmeras concluído sem erros.');
} finally {
  await browser.close();
  // encerra o grupo inteiro (npx + vite), senão a porta fica ocupada
  if (server) { try { process.kill(-server.pid); } catch { server.kill(); } }
}
