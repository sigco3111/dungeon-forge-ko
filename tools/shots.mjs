// Pictures of the demo, muted, with the pointer-lock guard: node tools/shots.mjs <what> [url], then shots/<what>/*.png.
// What: themes (top and eye-height views of every theme), flight, tour. Serves the source itself unless a url is given.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { guard } from 'file:///C:/Users/drini/Patch/seeds/no-pointer-lock.mjs';

guard(chromium);
const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const what = process.argv[2] ?? 'themes';
let url = process.argv[3]?.startsWith('http') ? process.argv[3] : undefined;
let srv = null;
if (!url) {
	srv = await createServer({ configFile: path.join(here, 'vite.config.mjs'), server: { port: 5393 + Math.floor(Math.random() * 200), host: '127.0.0.1' }, logLevel: 'error' });
	await srv.listen();
	url = srv.resolvedUrls.local[0];
}
const out = path.join(here, 'shots', what);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const CHROME = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning') {
		const t = m.text();
		if (!t.includes('GPU stall')) console.log(`[${m.type()}] ${t.slice(0, 500)}`);
	}
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__block?.times?.ready > 0, null, { timeout: 90000 });
console.log('ready after', await page.evaluate(() => Math.round(window.__block.times.ready)), 'ms');
await page.addStyleTag({ content: '.hud{visibility:hidden!important}' });

const run = (js) => page.evaluate(`(async () => { const a = window.__block; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${js} })()`);
const levelDone = `await new Promise((r) => { const t = a.dungeon; const c = () => (a.dungeon !== t ? r() : setTimeout(c, 20)); c(); });`;
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
// Stand at a named spot, look at a target; cells.
const stand = (spot) => run(`
	const d = a.dungeon, w = a.walker, r = a.view.rig;
	const room = (t) => d.rooms.find((q) => q.type === t) ?? d.rooms[0];
	const big = d.rooms.filter((q) => q.type === 'combat').sort((p, q) => q.w * q.h - p.w * p.h)[0];
	const put = (cx, cy, tx, ty) => { w.x = cx - d.W / 2; w.z = cy - d.H / 2; w.yaw = Math.atan2(cx - tx, cy - ty); w.pitch = 0; w.vx = w.vz = 0; };
	const spot = ${JSON.stringify(spot)};
	if (spot === 'entrance') { w.start(); }
	if (spot === 'room') put(big.x0 + 1.5, big.y0 + 1.5, big.cx, big.cy);
	if (spot === 'boss') { const b = room('boss'); put(b.x0 + 1.5, b.cy + 0.5, b.cx + 0.5, b.cy + 0.5); }
	if (spot === 'treasure') { const b = room('treasure'); put(b.cx - 2 + 0.5, b.cy + 2 + 0.5, b.cx + 0.5, b.cy + 0.5); }
	if (spot === 'shrine') { const b = room('shrine'); put(b.cx - 2.2 + 0.5, b.cy + 1.8 + 0.5, b.cx + 0.5, b.cy + 0.5); }
	if (spot === 'corridor') {
		let best = null, len = 0;
		for (let y = 0; y < d.H; y++) { let s = -1; for (let x = 0; x <= d.W; x++) { const on = x < d.W && d.corridor[y * d.W + x]; if (on && s < 0) s = x; if (!on && s >= 0) { if (x - s > len) { len = x - s; best = { y, s, e: x - 1 }; } s = -1; } } }
		put(best.s + 0.5, best.y + 0.5, best.e + 0.5, best.y + 0.5);
	}
	if (spot === 'up') { put(big.cx + 0.5 + 1.1, big.cy + 0.5 + 1.1, big.x0, big.y0); w.pitch = 0.75; }
	r.eye.set(w.x, 1.07, w.z); r.eyeYaw = w.yaw; r.eyePitch = w.pitch;
`);
const steps = {
	async themes() {
		for (const th of ['ancient', 'molten', 'frost', 'grim', 'verdant']) {
			await run(`a.setWalking(false, false); a.view.rig.t = 0; const t = a.dungeon; a.set('theme', '${th}'); if (a.values.theme !== t.params.theme) await new Promise((r) => { const c = () => (a.dungeon !== t ? r() : setTimeout(c, 20)); c(); }); await sleep(400);`);
			await shot(`${th}-0top`);
			await run(`a.setWalking(true, false); a.view.rig.t = 1; await sleep(120);`);
			for (const s of ['entrance', 'corridor', 'room', 'boss']) {
				await stand(s);
				await page.waitForTimeout(220);
				await shot(`${th}-${s}`);
			}
		}
	},
	async detail() {
		const th = process.argv[4] ?? process.argv[3] ?? 'ancient';
		await run(`const t = a.dungeon; if (a.values.theme !== '${th}') { a.set('theme', '${th}'); await new Promise((r) => { const c = () => (a.dungeon !== t ? r() : setTimeout(c, 20)); c(); }); } a.setWalking(true, false); a.view.rig.t = 1; await sleep(120);`);
		for (const s of ['entrance', 'corridor', 'room', 'boss', 'treasure', 'shrine', 'up']) {
			await stand(s);
			await page.waitForTimeout(300);
			await shot(s);
		}
	},
	async controls() {
		const change = (id, value) => run(`const t = a.dungeon; a.set('${id}', ${JSON.stringify(value)}); if (['rooms', 'loops', 'seed', 'decor', 'theme'].includes('${id}')) await new Promise((r) => { const c = () => (a.dungeon !== t ? r() : setTimeout(c, 20)); c(); }); await sleep(350);`);
		let n = 0;
		for (const [id, lo, hi, base] of [['rooms', 8, 60, 24], ['loops', 0, 100, 30], ['graph', false, true, false], ['tilt', 0, 1, 1], ['bloom', 0, 2, 0.9], ['light', 0.2, 2.5, 1]]) {
			await change(id, lo);
			await shot(`${String(n++).padStart(2, '0')}-${id}-low`);
			await change(id, hi);
			await shot(`${String(n++).padStart(2, '0')}-${id}-high`);
			await change(id, base);
		}
		await run(`a.setWalking(true, false); a.view.rig.t = 1; await sleep(100);`);
		for (const [id, lo, hi, base] of [['decor', 0, 100, 60], ['light', 0.2, 2.5, 1], ['bloom', 0, 2, 0.9]]) {
			await stand('room');
			await change(id, lo);
			await stand('room');
			await page.waitForTimeout(150);
			await shot(`${String(n++).padStart(2, '0')}-walk-${id}-low`);
			await change(id, hi);
			await stand('room');
			await page.waitForTimeout(150);
			await shot(`${String(n++).padStart(2, '0')}-walk-${id}-high`);
			await change(id, base);
		}
	},
	async hud() {
		await page.addStyleTag({ content: '.hud.on{visibility:visible!important}' });
		await page.mouse.click(640, 360);
		await page.waitForTimeout(300);
		await shot('0-map');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2300);
		await shot('1-walk');
		await page.keyboard.down('KeyW');
		await page.waitForTimeout(2600);
		await shot('2-walking');
		await page.keyboard.up('KeyW');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1800);
		await run(`a.newDungeon();`);
		await page.waitForTimeout(110);
		for (let i = 0; i < 5; i++) {
			await shot(`3-reveal-${i}`);
			await page.waitForTimeout(150);
		}
	},
	async flight() {
		await run(`a.setWalking(true, false); a.view.rig.t = 0;`);
		for (let i = 0; i <= 8; i++) {
			await run(`a.view.rig.t = ${i / 8}; await sleep(90); a.view.rig.t = ${i / 8};`);
			await shot(`t${i}`);
		}
	},
};
await steps[what]();
await browser.close();
await srv?.close();
process.exit(0);
