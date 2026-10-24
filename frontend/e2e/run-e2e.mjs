/**
 * Teste ponta a ponta (Playwright + Chromium): percorre o fluxo completo da missão LEO
 * com a arquitetura de referência, do nome do jogador ao relatório final.
 * Uso: npm run build && npm run test:e2e   (sobe `vite preview` automaticamente)
 * Variáveis: E2E_URL (usar servidor já em execução), E2E_MISSION (padrão leo-climate), E2E_HEADED=1.
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
  base = 'http://127.0.0.1:4173';
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: join(here, '..'), stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite preview não iniciou')), 30000);
    server.stdout.on('data', (d) => { if (String(d).includes('4173')) { clearTimeout(t); resolve(); } });
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
  catch (e) { await page.screenshot({ path: join(artifacts, `fail-${name.replace(/\W+/g, '-')}.png`) }); throw new Error(`${name}: ${e.message}`); }
};
const shot = (n) => page.screenshot({ path: join(artifacts, `${n}.png`) });

try {
  await step('abrir a aplicação', async () => { await page.goto(base); await page.getByTestId('player-name').waitFor(); });
  await step('nome só com espaços é rejeitado', async () => {
    await page.getByTestId('player-name').fill('   ');
    await page.getByTestId('start-button').click();
    await page.getByText('não pode conter apenas espaços').waitFor();
  });
  await step('identificação', async () => { await page.getByTestId('player-name').fill('Equipe E2E'); await page.getByTestId('start-button').click(); await page.getByTestId(`mission-${mission}`).waitFor(); await shot('01-missoes'); });
  await step('seleção da missão', async () => { await page.getByTestId(`mission-${mission}`).click(); await page.getByTestId('assist-iniciante').click(); await page.getByTestId('confirm-mission').click(); await page.getByTestId('catalog-search').waitFor(); });
  await step('hangar: lançador bloqueado sem estrutura', async () => {
    const disabled = await page.locator('.topbar .stage', { hasText: 'Lançador' }).isDisabled();
    if (!disabled) throw new Error('etapa Lançador deveria estar bloqueada sem barramento');
  });
  await step('hangar: arquitetura de referência', async () => {
    await page.getByTestId('apply-suggestion').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="installed-list"] li').length > 5);
    await page.waitForTimeout(2500);
    await shot('02-hangar');
  });
  await step('escolher lançador', async () => {
    await page.getByTestId('to-vehicle').click();
    const ref = { 'leo-climate': 'falcon-9', 'lunar-he3': 'falcon-9', 'jupiter-system': 'falcon-heavy' }[mission];
    await page.getByTestId(`vehicle-${ref}`).click();
    await page.getByTestId('select-vehicle').click();
    await page.waitForTimeout(1500);
    await shot('03-lancador');
  });
  await step('planejamento', async () => { await page.getByTestId('to-planning').click(); await page.getByTestId('stat-dv').waitFor();
    // Júpiter: a data padrão está fora da janela de propósito; o jogador ajusta pela janela calculada
    if (await page.getByTestId('snap-window').isVisible().catch(() => false)) { await page.getByTestId('snap-window').click(); console.log('  data de partida ajustada para a janela calculada'); }
    await page.waitForTimeout(800); await shot('04-trajetoria'); });
  await step('briefing aprovado', async () => {
    await page.getByTestId('to-briefing').click();
    await page.getByTestId('briefing-status').waitFor();
    const status = await page.getByTestId('briefing-status').textContent();
    await shot('05-briefing');
    if (!status?.includes('APROVADO')) throw new Error(`briefing não aprovado: ${status}`);
    if (process.env.E2E_EXPECT_BACKEND) {
      await page.waitForFunction(() => /Servidor confirma/.test(document.querySelector('[data-testid="server-validation"]')?.textContent ?? ''), null, { timeout: 15000 });
      console.log('  revalidação no servidor confirmada');
    }
  });
  await step('plataforma e verificações', async () => {
    await page.getByTestId('to-launch').click();
    await page.getByTestId('start-procedures').click();
    await page.waitForFunction(() => /PRONTO|HOLD/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 20000 });
    await shot('06-plataforma');
  });
  await step('lançamento até a órbita', async () => {
    // Condições não bloqueantes: hold para reciclar; bloqueantes impedem o GO
    for (let i = 0; i < 5 && await page.getByTestId('confirm-launch').isDisabled(); i++) {
      if (await page.getByTestId('hold').isEnabled()) await page.getByTestId('hold').click();
      await page.waitForTimeout(7000);
    }
    await page.getByTestId('confirm-launch').click();
    await page.waitForFunction(() => /EM VOO/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 30000 });
    await page.getByTestId('warp-20').click();
    await page.waitForTimeout(3000);
    await shot('07-voo');
    await page.waitForFunction(() => /ÓRBITA|FALHA|ABORT/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 180000 });
    await shot('08-orbita');
    const st = await page.getByTestId('launch-state').textContent();
    console.log(`  estado final do lançamento: ${st}`);
    await page.getByTestId('launch-continue').click();
  });
  const reachedOrbit = await page.getByTestId('ops-log').isVisible().catch(() => false);
  if (reachedOrbit) {
    const answer = async () => {
      const btn = page.locator('[data-testid^="resp-"]').first();
      if (await btn.isVisible().catch(() => false)) await btn.click();
    };
    await step('manobras', async () => {
      for (let i = 0; i < 8; i++) {
        await answer();
        const b = page.locator('[data-testid^="mnv-"]:not([disabled])').first();
        if (!(await b.isVisible().catch(() => false))) break;
        await b.click();
        await page.waitForTimeout(300);
      }
      await answer();
      await shot('09-manobras');
      await page.getByTestId('to-science').click();
    });
    await step('checkpoints científicos', async () => {
      for (let i = 0; i < 10; i++) {
        await answer();
        const b = page.locator('[data-testid^="cp-"]').first();
        if (!(await b.isVisible().catch(() => false))) break;
        await b.click();
        await page.waitForTimeout(200);
      }
      await answer();
      await shot('10-ciencia');
      await page.getByTestId('finish-mission').click();
    });
  }
  await step('relatório final', async () => {
    await page.getByTestId('classification').waitFor({ timeout: 15000 });
    console.log(`  classificação: ${await page.getByTestId('classification').textContent()} · ciência ${await page.getByTestId('science-score').textContent()}`);
    await shot('11-relatorio');
  });
  await step('persistência após recarregar', async () => {
    await page.reload();
    await page.getByTestId('classification').waitFor({ timeout: 15000 });
  });
  if (errors.length) throw new Error(`erros no console:\n${errors.join('\n')}`);
  console.log('E2E concluído sem erros.');
} finally {
  await browser.close();
  server?.kill();
}
