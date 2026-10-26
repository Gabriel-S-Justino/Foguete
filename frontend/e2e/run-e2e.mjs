/**
 * Teste ponta a ponta (Playwright + Chromium): percorre o fluxo completo de uma missão com a arquitetura de
 * referência, do nome do jogador ao relatório final (órbita de estacionamento, volta completa, partida, separação,
 * manobras no instante calculado, vistas e escalas).
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
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: join(here, '..'), stdio: 'pipe', detached: true });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite preview não iniciou')), 30000);
    server.stdout.on('data', (d) => { if (String(d).includes('4173')) { clearTimeout(t); resolve(); } });
  });
}

const errors = [];
const browser = await chromium.launch({ headless: !process.env.E2E_HEADED, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (process.env.E2E_DEBUG && m.type() !== 'error') console.log(`  [${m.type()}] ${m.text()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|\/api\//.test(m.text())) errors.push(`console: ${m.text()}`); });

const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { await page.screenshot({ path: join(artifacts, `fail-${name.replace(/\W+/g, '-')}.png`) }); if (errors.length) console.error(errors.join('\n')); throw new Error(`${name}: ${e.message}`); }
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
    await page.waitForFunction(() => /PRONTO|HOLD/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 90000 });
    await shot('06-plataforma');
  });
  await step('lançamento até a órbita', async () => {
    // Condições não bloqueantes: hold para reciclar; bloqueantes impedem o GO
    for (let i = 0; i < 5 && await page.getByTestId('confirm-launch').isDisabled(); i++) {
      if (await page.getByTestId('hold').isEnabled()) await page.getByTestId('hold').click();
      await page.waitForTimeout(7000);
    }
    await page.getByTestId('confirm-launch').click();
    await page.waitForFunction(() => /EM VOO/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 90000 });
    await page.getByTestId('warp-20').click();
    await page.waitForTimeout(3000);
    await shot('07-voo');
    await page.waitForFunction(() => /ÓRBITA|FALHA|ABORT/.test(document.querySelector('[data-testid="launch-state"]')?.textContent ?? ''), null, { timeout: 300000 });
    await shot('08-orbita');
    const st = await page.getByTestId('launch-state').textContent();
    console.log(`  estado final do lançamento: ${st}`);
    // Na missão de órbita terrestre os painéis são estendidos ainda na tela de lançamento (o rastreio enquadra a sonda)
    if (mission === 'leo-climate' && await page.getByTestId('deploy-arrays').isVisible().catch(() => false)) {
      await page.getByTestId('deploy-arrays').click();
      await page.waitForTimeout(9000);
      await shot('08b-paineis-lancamento');
      if (await page.getByTestId('deploy-arrays').isVisible().catch(() => false)) throw new Error('botão de estender painéis continuou visível');
    }
    await page.getByTestId('launch-continue').click();
  });
  const reachedOrbit = await page.getByTestId('ops-log').isVisible().catch(() => false);
  if (reachedOrbit) {
    const answer = async () => {
      const btn = page.locator('[data-testid^="resp-"]').first();
      if (await btn.isVisible().catch(() => false)) await btn.click();
    };
    const orbit = () => page.evaluate(() => globalThis.__orbitView.info());
    // Espera uma condição da cena orbital respondendo às anomalias que pausam o relógio
    const until = async (cond, what, timeoutMs = 420000) => {
      const t0 = Date.now();
      for (;;) {
        await answer();
        const i = await orbit();
        if (await cond(i)) return i;
        if (Date.now() - t0 > timeoutMs) throw new Error(`tempo esgotado esperando ${what} (t=${i.t.toFixed(0)} s, trecho ${i.segmentId})`);
        await page.waitForTimeout(1000);
      }
    };
    await step('órbita da Terra: sonda real, sem marcador, volta completa antes da partida', async () => {
      await page.waitForFunction(() => Boolean(globalThis.__orbitView), null, { timeout: 30000 });
      await page.getByTestId('earth-orbit-phase').waitFor();
      const i0 = await orbit();
      if (i0.markerMeshes !== 0) throw new Error(`há ${i0.markerMeshes} malhas marcadoras na cena (a esfera da sonda foi removida)`);
      if (i0.segmentId !== 'parking') throw new Error(`a missão começou fora da órbita de estacionamento (${i0.segmentId})`);
      // Altitude orbital sobre o raio equatorial da Terra (6.378,137 km, JPL)
      if (Math.abs(i0.distanceM - i0.altitudeM - 6378137) > 1) throw new Error(`distância ao centro e altitude incoerentes: ${i0.distanceM} / ${i0.altitudeM}`);
      const hasDeparture = await page.getByTestId('command-departure').isVisible().catch(() => false);
      if (hasDeparture && await page.getByTestId('command-departure').isEnabled()) throw new Error('partida liberada antes da primeira volta');
      if (hasDeparture && !i0.stackAttached) throw new Error('a sonda deveria estar acoplada ao estágio superior na órbita de estacionamento');
      await page.getByTestId('view-probe').click();
      // A transição dura 1,4 s, mas no SwiftShader (1–3 FPS) só termina alguns quadros depois
      await page.waitForFunction(() => globalThis.__orbitView.info().cameraDistanceM < 200, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const ip = await orbit();
      if (ip.cameraDistanceM > 200) throw new Error(`vista da sonda longe demais (${ip.cameraDistanceM.toFixed(0)} m)`);
      if (!ip.probeModelVisible) throw new Error('modelo 3D da sonda não está visível na vista da sonda');
      console.log(`  vista da sonda: câmera a ${ip.cameraDistanceM.toFixed(0)} m, atitude ${ip.attitude}, estágio acoplado: ${ip.stackAttached}`);
      await shot('09a-sonda-orbita-terra');
      await page.getByTestId('view-trajectory').click();
      await page.getByTestId('warp-auto').click();
      const half = await until((i) => i.revolution.fraction > 0.4 && i.revolution.fraction < 0.9, 'meia volta');
      if (hasDeparture && await page.getByTestId('command-departure').isEnabled()) throw new Error(`partida liberada com ${(half.revolution.fraction * 100).toFixed(0)}% da volta`);
      const rev = await until((i) => i.revolution.complete, 'volta completa');
      await page.getByText('volta completa').first().waitFor();
      console.log(`  volta completa em t = ${(rev.t / 60).toFixed(1)} min (ângulo percorrido ${(rev.revolution.swept * 180 / Math.PI).toFixed(1)}°)`);
      await shot('09b-volta-completa');
      if (hasDeparture) {
        await page.getByTestId('command-departure').click();
        await page.getByTestId('departure-countdown').waitFor();
        const dep = await until((i) => i.segmentId !== 'parking', 'injeção de partida');
        console.log(`  partida: trecho "${dep.segmentLabel}" em t = ${(dep.t / 60).toFixed(1)} min`);
        await until((i) => !i.stackAttached, 'separação do estágio superior');
        await page.waitForFunction(() => /Separação da sonda/.test(document.querySelector('[data-testid="ops-log"]')?.textContent ?? ''), null, { timeout: 30000 });
        await shot('09c-separacao');
      }
    });
    await step('painéis solares', async () => {
      if (await page.getByTestId('arrays-notice').isVisible().catch(() => false)) {
        // Painéis dobrados: manobras bloqueadas até estender
        const enabled = await page.locator('[data-testid^="mnv-"]:not([disabled])').count();
        if (enabled > 0) throw new Error('manobra liberada com os painéis solares dobrados');
        await page.getByTestId('deploy-arrays').click();
        await page.waitForTimeout(4000);
        const mid = await orbit();
        await page.waitForTimeout(8000);
        const end = await orbit();
        console.log(`  abertura dos painéis: ${mid.deployment.toFixed(2)} → ${end.deployment.toFixed(2)} (vista ${end.focus})`);
        if (!(mid.deployment > 0 && mid.deployment < 1)) throw new Error(`abertura não foi animada (${mid.deployment})`);
        if (end.deployment < 0.99) throw new Error('painéis não terminaram de abrir');
        await shot('09d-sonda-paineis-abertos');
        await page.getByTestId('view-trajectory').click();
      } else {
        const i = await orbit();
        console.log(`  painéis já estendidos (abertura ${i.deployment.toFixed(2)}, painéis: ${i.hasArrays})`);
      }
    });
    await step('vistas e escalas', async () => {
      // Relógio pausado: a troca de escala não pode mudar nada da simulação
      await page.getByTestId('clock-run').click();
      await page.getByTestId('view-system').click();
      await page.waitForTimeout(2500);
      const sys = await orbit();
      if (sys.scale !== 'physical' || sys.enlarged.length) throw new Error('a vista começou fora da escala física');
      await shot('09e-sistema-escala-fisica');
      await page.getByTestId('scale-didactic').click();
      await page.waitForTimeout(1500);
      const did = await orbit();
      const note = await page.getByTestId('scale-note').textContent();
      if (!/didática/.test(note ?? '') || did.enlarged.length < 8) throw new Error(`visualização didática sem aviso ou sem corpos ampliados: ${note}`);
      if (did.t !== sys.t || did.distanceM !== sys.distanceM || did.segmentId !== sys.segmentId) throw new Error(`o modo de escala alterou a simulação (t ${sys.t} → ${did.t}, distância ${sys.distanceM} → ${did.distanceM})`);
      const labels = await page.evaluate(() => [...document.querySelectorAll('.orbit-label')].filter((e) => e.style.display !== 'none').map((e) => e.textContent));
      if (labels.length < 8) throw new Error(`poucos rótulos visíveis na vista do sistema: ${labels.join(', ')}`);
      console.log(`  didática: ${did.enlarged.map((e) => `${e.name} ×${Math.round(e.factor)}`).join(', ')}`);
      await shot('09f-sistema-didatica');
      await page.getByTestId('scale-physical').click();
      await page.getByTestId('view-destination').click();
      await page.waitForTimeout(2500);
      await shot('09g-destino');
      await page.getByTestId('view-trajectory').click();
      await page.getByTestId('clock-run').click();
    });
    await step('manobras no instante calculado', async () => {
      let n = 0;
      for (let k = 0; k < 6; k++) {
        const remaining = await page.locator('[data-testid^="mnv-"]').count();
        if (!remaining) break;
        // O relógio para no instante da manobra e o botão é liberado
        await until(async () => (await page.locator('[data-testid^="mnv-"]:not([disabled])').count()) > 0, 'manobra liberada');
        const b = page.locator('[data-testid^="mnv-"]:not([disabled])').first();
        const id = (await b.getAttribute('data-testid')).slice(4);
        const at = await orbit();
        if (/^(loi|joi)$/.test(id) && at.attitude !== 'retrograde') throw new Error(`${id}: atitude ${at.attitude}, esperada retrógrada`);
        console.log(`  ${id}: relógio parado em t = ${(at.t / 86400).toFixed(2)} dias, trecho "${at.segmentLabel}", altitude ${(at.altitudeM / 1000).toFixed(0)} km sobre ${at.centerName}, atitude ${at.attitude}`);
        // Δv cobrado = o calculado pela trajetória (o orçado é só referência)
        const dvText = await page.getByTestId(`dv-calc-${id}`).textContent().catch(() => null);
        const calc = dvText ? Number(/trajetória: ([\d.]+)/.exec(dvText)?.[1]) : NaN;
        await b.click();
        await page.waitForTimeout(1000);
        if (Number.isFinite(calc)) {
          const log = await page.getByTestId('ops-log').innerText();
          const exec = [...log.matchAll(/Δv ([\d.]+) m\/s com/g)].map((x) => Number(x[1])).pop();
          console.log(`    Δv executado ${exec} m/s, calculado pela trajetória ${calc} m/s`);
          if (exec === undefined || Math.abs(exec - calc) > Math.max(1, calc * 0.05)) throw new Error(`${id}: Δv executado ${exec} ≠ calculado ${calc}`);
        }
        await shot(`09-manobra-${++n}-${id}`);
      }
      await answer();
      await until(async () => page.getByTestId('to-science').isEnabled(), 'liberação da ciência', 120000);
      const fin = await orbit();
      console.log(`  final: trecho "${fin.segmentLabel}", altitude ${(fin.altitudeM / 1000).toFixed(0)} km sobre ${fin.centerName}`);
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
  // encerra o grupo inteiro (npx + vite), senão a porta fica ocupada
  if (server) { try { process.kill(-server.pid); } catch { server.kill(); } }
}
