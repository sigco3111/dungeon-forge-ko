// Plays hard for minutes in real Chrome with its own profile: node tools/soak.mjs [minutes, default 4] [folder, default dist].
// Rapid input, every control at both ends, every theme both ways, resets, walking and running throughout. Logs frames over 100 ms
// with what was just done, long tasks, GL errors, a lost context and the JS heap. Muted, with the pointer-lock guard. Exit 1 on an
// error or a lost context.
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { guard } from 'file:///C:/Users/drini/Patch/seeds/no-pointer-lock.mjs';

guard(chromium);
const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const minutes = Number(process.argv[2] ?? 4);
const root = path.resolve(process.argv[3] ?? path.join(here, 'dist'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.json': 'application/json', '.txt': 'text/plain' };
const srv = createServer((req, res) => {
	const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
	if (!fs.existsSync(p)) return void res.writeHead(404).end();
	res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
	fs.createReadStream(p).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dungeons-soak-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1600, height: 900 }, args: ['--mute-audio'] });
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(`console ${m.text().slice(0, 300)}`);
});
await page.addInitScript(() => {
	window.__soak = { frames: 0, slow: [], longs: [], lost: 0, action: 'load', worst: 0 };
	let last = 0;
	const loop = (t) => {
		const s = window.__soak;
		if (last && window.__block?.times?.ready) {
			const gap = t - last;
			s.frames++;
			if (gap > s.worst) s.worst = gap;
			if (gap > 100) s.slow.push([Math.round(gap), s.action]);
		}
		last = t;
		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
	new PerformanceObserver((l) => {
		for (const e of l.getEntries()) if (window.__block?.times?.ready) window.__soak.longs.push([Math.round(e.duration), window.__soak.action]);
	}).observe({ entryTypes: ['longtask'] });
	addEventListener('webglcontextlost', () => window.__soak.lost++, true);
});
await page.goto(`http://127.0.0.1:${srv.address().port}/`);
await page.waitForFunction(() => window.__block?.times?.ready > 0, null, { timeout: 120000 });
console.log('ready after', await page.evaluate(() => Math.round(window.__block.times.ready)), 'ms');
await page.mouse.click(800, 450);

const say = (a) => page.evaluate((x) => {
	window.__soak.action = x;
}, a);
const app = (js) => page.evaluate(`(async () => { const a = window.__block; ${js} })()`);
const THEMES = ['ancient', 'molten', 'frost', 'grim', 'verdant'];
const END = Date.now() + minutes * 60000;
const pick = (x) => x[Math.floor(Math.random() * x.length)];
let round = 0;
let pc = 0;
const actions = {
	async theme() {
		const t = pick(THEMES);
		await say(`theme ${t}`);
		await app(`a.set('theme', '${t}')`);
		await page.waitForTimeout(250);
	},
	async themesBothWays() {
		for (const t of [...THEMES, ...[...THEMES].reverse()]) {
			await say(`theme ${t} (all)`);
			await app(`a.set('theme', '${t}')`);
			await page.waitForTimeout(110);
		}
	},
	async roomsEnds() {
		for (const r of [8, 60, 8, 24]) {
			await say(`rooms ${r}`);
			await app(`a.set('rooms', ${r})`);
			await page.waitForTimeout(500);
		}
	},
	async roomsDrag() {
		for (let r = 8; r <= 60; r += 3) {
			await say(`rooms drag ${r}`);
			await app(`a.set('rooms', ${r})`);
			await page.waitForTimeout(25);
		}
		await app(`a.set('rooms', 24)`);
	},
	async loopsEnds() {
		for (const l of [0, 100, 0, 30]) {
			await say(`loops ${l}`);
			await app(`a.set('loops', ${l})`);
			await page.waitForTimeout(400);
		}
	},
	async newDungeons() {
		for (let i = 0; i < 4; i++) {
			await say('new dungeon');
			await app('a.newDungeon()');
			await page.waitForTimeout(300);
		}
	},
	async walkRun() {
		await say('enter');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2100);
		await say('run');
		await page.keyboard.down('ShiftLeft');
		await page.keyboard.down('KeyW');
		for (let i = 0; i < 16; i++) {
			await page.mouse.move(800 + Math.random() * 500 - 250, 450 + Math.random() * 100 - 50, { steps: 3 });
			await page.keyboard.press(pick(['KeyA', 'KeyD']));
			await page.waitForTimeout(170);
		}
		await page.keyboard.up('KeyW');
		await page.keyboard.up('ShiftLeft');
		await say('new while walking');
		await app('a.newDungeon()');
		await page.waitForTimeout(500);
		await say('theme while walking');
		await app(`a.set('theme', '${pick(THEMES)}')`);
		await page.waitForTimeout(400);
		await say('back');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1700);
	},
	async bigWalk() {
		await say('60 rooms, many loops, walking');
		await app(`a.set('rooms', 60); a.set('loops', 100)`);
		await page.waitForTimeout(600);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2100);
		await page.keyboard.down('KeyW');
		await page.waitForTimeout(1500);
		await page.keyboard.up('KeyW');
		await say('leaving the big one');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1700);
		await app(`a.set('rooms', 24); a.set('loops', 30)`);
		await page.waitForTimeout(300);
	},
	async toggleFast() {
		for (let i = 0; i < 6; i++) {
			await say('enter toggled fast');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(150 + Math.random() * 300);
		}
		if (await page.evaluate(() => window.__block.isWalking())) await page.keyboard.press('Enter');
		await page.waitForTimeout(1500);
	},
	async look() {
		for (const [k, v] of [['bloom', 0], ['bloom', 2], ['bloom', 0.9], ['tilt', 0], ['tilt', 1], ['light', 0.2], ['light', 2.5], ['light', 1], ['decor', 0], ['decor', 100], ['decor', 60], ['graph', true], ['graph', false]]) {
			await say(`${k} ${v}`);
			await app(`a.set('${k}', ${v})`);
			await page.waitForTimeout(90);
		}
	},
	async reset() {
		await say('reset');
		await app('a.reset()');
		await page.waitForTimeout(500);
	},
};
const order = Object.keys(actions);
const load = [];
while (Date.now() < END) {
	// A covered window runs at one frame a second, which looks exactly like a stall.
	await page.bringToFront();
	load.push(execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits').toString().trim());
	await actions[order[pc++ % order.length]]();
	if (pc % order.length === 0) round++;
}
const r = await page.evaluate(async () => {
	const gl = window.__block.renderer.getContext();
	const s = window.__soak;
	return { frames: s.frames, worst: Math.round(s.worst), slow: s.slow, longs: s.longs, lost: s.lost, glError: gl.getError(), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, pixelCap: window.__block.view.pixelCap, geometries: window.__block.renderer.info.memory.geometries, textures: window.__block.renderer.info.memory.textures };
});
const tally = (list) => {
	const by = {};
	for (const [ms, a] of list) {
		const k = a.replace(/\d+/g, '#');
		by[k] = by[k] ?? { n: 0, worst: 0 };
		by[k].n++;
		by[k].worst = Math.max(by[k].worst, ms);
	}
	return by;
};
console.log(`rounds ${round}, frames ${r.frames}, worst ${r.worst} ms, over 100 ms: ${r.slow.length}, long tasks: ${r.longs.length}, lost contexts ${r.lost}, GL error ${r.glError}, heap ${r.heapMB} MB, pixel cap ${r.pixelCap}, geometries ${r.geometries}, textures ${r.textures}`);
console.log('GPU load by action', load.join(' '), '; game open:', execSync('tasklist').toString().toLowerCase().includes('valheim'));
console.log('slow frames by action', JSON.stringify(tally(r.slow), null, 1));
console.log('long tasks by action', JSON.stringify(tally(r.longs), null, 1));
console.log('errors', errors.length, errors.slice(0, 5).join('\n'));
await context.close();
srv.close();
fs.rmSync(profile, { recursive: true, force: true });
process.exit(errors.length || r.lost ? 1 : 0);
