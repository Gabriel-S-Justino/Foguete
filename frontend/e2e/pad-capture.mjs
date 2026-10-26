/**
 * Capturas da plataforma de lançamento de cada família de veículo, sem passar pelo fluxo do jogo: abre o app no
 * servidor de desenvolvimento do Vite e mostra a cena da plataforma direto pelo SceneManager (módulos
 * importados pelo próprio Vite, a mesma instância usada pelo app).
 *
 * Uso: node e2e/pad-capture.mjs   Variáveis: CAPTURE_DIR, PAD_VEHICLES (lista separada por vírgulas).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.CAPTURE_DIR ?? join(here, '..', 'capture-pad');
mkdirSync(out, { recursive: true });
const vehicles = (process.env.PAD_VEHICLES ?? 'falcon-9,falcon-heavy,sls,starship,new-glenn,soyuz').split(',');
const port = Number(process.env.PAD_PORT ?? 5181);
const server = process.env.PAD_PORT ? null : spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: join(here, '..'), stdio: 'pipe', detached: true });
if (server) await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite não iniciou')), 60000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(port))) { clearTimeout(t); resolve(); } });
});
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const report = [];
try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByTestId('player-name').waitFor({ timeout: 120000 });
  // O Vite pode reotimizar dependências e recarregar a página na primeira visita: espera e recarrega uma vez
  await page.waitForTimeout(15000);
  await page.reload();
  await page.getByTestId('player-name').waitFor({ timeout: 120000 });
  await page.waitForTimeout(5000);
  page.setDefaultTimeout(180000);
  log('app carregado');
  for (const id of vehicles) {
    log(`montando ${id}`);
    await page.evaluate(async (id) => {
      const { createLaunchPadScene } = await import('/src/engine/scenes/launchPadScene.ts');
      const { getVehicle } = await import('/src/engine/catalog/index.ts');
      await globalThis.__sceneManager.show(`pad-${id}`, (e) => createLaunchPadScene(e, getVehicle(id), []));
      const s = globalThis.__sceneManager.controller.scene;
      s.activeCamera = s.cameras.find((c) => c.getClassName() === 'ArcRotateCamera');
    }, id);
    log('cena pronta');
    await page.waitForTimeout(8000);
    const shots = [
      ['geral', { target: [0, 45, 0], alpha: -2.2, beta: 1.33, radius: 260 }],
      ['torre', { target: [0, 40, 0], alpha: -2.75, beta: 1.42, radius: 140 }],
      ['base', { target: [0, 14, 0], alpha: -1.0, beta: 1.2, radius: 75 }],
    ];
    for (const [n, o] of shots) {
      await page.evaluate((o) => {
        const c = globalThis.__sceneManager.controller.scene.activeCamera;
        c.setTarget(new c.target.constructor(...o.target));
        c.alpha = o.alpha; c.beta = o.beta; c.radius = o.radius;
      }, o);
      await page.waitForTimeout(4000);
      const name = `pad-${id}-${n}`;
      await page.screenshot({ path: join(out, `${name}.png`), timeout: 180000 });
      report.push({ name, fps: await page.evaluate(() => globalThis.__sceneManager.status.fps) });
      console.log(`  ${name} (${report.at(-1).fps} FPS)`);
    }
  }
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ report, errors }, null, 2));
  if (errors.length) console.error(`erros no console:\n${errors.join('\n')}`); else console.log('sem erros no console');
  await browser.close();
  if (server) try { process.kill(-server.pid); } catch { /* já encerrado */ }
}
