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
    await page.waitForFunction(() => /PRONTO|HOLD/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 90000 });
    for (let i = 0; i < 5 && await page.getByTestId('confirm-launch').isDisabled(); i++) {
      if (await page.getByTestId('hold').isEnabled()) await page.getByTestId('hold').click();
      await page.waitForTimeout(7000);
    }
    await camera('overview');
    await page.getByTestId('confirm-launch').click();
    await page.waitForFunction(() => /EM VOO/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 90000 });
    await page.waitForTimeout(2500);
    await shot('03-geral-decolagem');
    // Decolagem: o foguete sobe na vertical antes de inclinar (não escorrega para o lado)
    const lift = await info();
    const altLift = lift.rocketPad[1];
    assert(Math.abs(lift.rocketPad[0]) < 60, `foguete deslocou ${lift.rocketPad[0].toFixed(1)} m para o lado logo na decolagem`);
    assert(lift.tiltDeg < 5, `foguete já inclinado ${lift.tiltDeg.toFixed(1)}° na decolagem`);
    const down0 = await camera('externalDown');
    await shot('04-externa-baixo-decolagem');
    await page.waitForTimeout(1500);
    const down1 = await info();
    assert(down1.position[1] > down0.position[1], 'câmera externa não acompanhou a subida do foguete');
    await camera('externalUp');
    await shot('05-externa-cima-decolagem');
    await page.getByTestId('warp-5').click();
    await camera('tracking');
    await page.waitForTimeout(3000);
    await shot('06-rastreio-subida');
    const climb = await info();
    assert(climb.rocketPad[1] > altLift, 'foguete não subiu');
    await camera('cinematic');
    await page.waitForTimeout(1500);
    await shot('07-cinematica');
    await camera('tracking');
    // Trajetória: amostras de inclinação e posição durante a subida
    await page.getByTestId('warp-10').click();
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(2500);
      const s = await info();
      samples.push(s);
      if (/separa/i.test(await page.getByTestId('terminal').textContent())) break;
    }
    console.log('  amostras (alcance km, altura km, inclinação °, fumaça):', samples.map((s) => `${(s.rocketPad[0] / 1000).toFixed(1)}/${(s.rocketPad[1] / 1000).toFixed(1)}/${s.tiltDeg.toFixed(0)}/${s.smokeParticles}`).join('  '));
    assert(samples.some((s) => s.smokeParticles > 30), 'rastro de fumaça da trajetória não apareceu');
    const tilts = samples.map((s) => s.tiltDeg);
    assert(tilts[tilts.length - 1] > tilts[0] + 5, `inclinação não aumentou na curva de gravidade (${tilts.map((t) => t.toFixed(0)).join(', ')})`);
    await shot('07b-rastreio-curva-gravidade');
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
    await camera('tracking');
    await page.getByTestId('warp-20').click();
    await page.waitForFunction(() => /ÓRBITA|FALHA|ABORT/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 300000 });
    const state = await page.getByTestId('launch-state').textContent();
    await page.waitForTimeout(1500);
    await shot('11-rastreio-orbita');
    const fin = await info();
    console.log(`  estado final: ${state}; alcance ${(fin.rocketPad[0] / 1000).toFixed(0)} km, altura ${(fin.rocketPad[1] / 1000).toFixed(0)} km, inclinação ${fin.tiltDeg.toFixed(0)}°, fumaça ${fin.smokeParticles}`);
    if (/ÓRBITA/.test(state ?? '')) {
      // Em órbita o eixo fica no horizonte local: 90° + ângulo central percorrido (alcance / raio da Terra)
      const expected = 90 + (Math.atan2(fin.rocketPad[0], fin.rocketPad[1] + 6371000) * 180) / Math.PI;
      assert(Math.abs(fin.tiltDeg - expected) < 12, `atitude em órbita ${fin.tiltDeg.toFixed(0)}° ≠ horizonte local ${expected.toFixed(0)}°`);
      // A câmera continua acompanhando o veículo em órbita
      await page.waitForTimeout(3000);
      const later = await info();
      assert(Math.hypot(later.rocketPad[0] - fin.rocketPad[0], later.rocketPad[1] - fin.rocketPad[1]) > 1000, 'veículo parado depois da inserção em órbita');
      assert(Math.hypot(later.position[0] - later.rocketPad[0], later.position[1] - later.rocketPad[1], later.position[2] - later.rocketPad[2]) < 2000, 'câmera de rastreio não acompanhou o veículo em órbita');
    }
    await camera('externalDown');
    await page.waitForTimeout(1000);
    await shot('12-externa-baixo-final');
  });
  if (errors.length) throw new Error(`erros no console:\n${errors.join('\n')}`);
  console.log('E2E de câmeras concluído sem erros.');
} finally {
  await browser.close();
  // encerra o grupo inteiro (npx + vite), senão a porta fica ocupada
  if (server) { try { process.kill(-server.pid); } catch { server.kill(); } }
}
