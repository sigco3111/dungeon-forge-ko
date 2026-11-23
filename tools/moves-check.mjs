// A person's first minute, with a real mouse and keyboard, inside a cross-origin frame like the block page's. Serves dist/.
// node tools/moves-check.mjs [folder, default dist]. Muted, with the pointer-lock guard. Fails with exit 1.
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { guard } from 'file:///C:/Users/drini/Patch/seeds/no-pointer-lock.mjs';

guard(chromium);
const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.argv[2] ?? path.join(here, 'dist'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.json': 'application/json', '.txt': 'text/plain' };
const demo = createServer((req, res) => {
	const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
	if (!fs.existsSync(p)) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
	fs.createReadStream(p).pipe(res);
});
await new Promise((r) => demo.listen(0, '127.0.0.1', r));
const port = demo.address().port;
const shell = createServer((_, res) => {
	res.writeHead(200, { 'content-type': 'text/html' });
	res.end(`<!doctype html><body style="margin:0;background:#222"><iframe id="f" src="http://127.0.0.1:${port}/" style="position:fixed;inset:0;width:100%;height:100%;border:0" sandbox="allow-scripts allow-same-origin allow-pointer-lock"></iframe></body>`);
});
await new Promise((r) => shell.listen(0, 'localhost', r));

const CHROME = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
await page.goto(`http://localhost:${shell.address().port}/`);
const frame = () => page.frames().find((f) => f.url().includes(`:${port}/`));
await page.waitForFunction(() => document.getElementById('f'));
for (let i = 0; i < 300 && !frame(); i++) await page.waitForTimeout(100);
const f = frame();
await f.waitForFunction(() => window.__block?.times?.ready > 0, null, { timeout: 60000 });
const results = [];
const ok = (name, pass, detail = '') => {
	results.push([pass, name, detail]);
	console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const pose = () => f.evaluate(() => {
	const a = window.__block;
	return { x: a.walker.x, z: a.walker.z, yaw: a.walker.yaw, pitch: a.walker.pitch, t: a.view.rig.t, walking: a.isWalking(), zoom: a.view.rig.zoom, fov: a.view.rig.fov, tx: a.view.rig.target.x, tz: a.view.rig.target.z, seed: a.dungeon.seed, place: a.lastPlace, h: document.getElementById('name').textContent };
});
const CX = 640;
const CY = 360;
const before = await pose();
ok('opens on the map', before.t === 0 && !before.walking);
ok('the dungeon has a name', before.h.length > 8, before.h);

// Keys before any click go to the page, not the frame.
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
ok('Enter before the first click does nothing', !(await pose()).walking);
await page.mouse.move(CX, CY);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(100);
ok('the first click only takes the keyboard', !(await pose()).walking);

// The map: drag and scroll.
await page.mouse.move(CX, CY);
await page.mouse.down();
await page.mouse.move(CX + 120, CY + 40, { steps: 6 });
await page.mouse.up();
let p = await pose();
ok('dragging moves the map', Math.hypot(p.tx - before.tx, p.tz - before.tz) > 1);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(80);
ok('scroll zooms the map', (await pose()).zoom > before.zoom);

// Down into it.
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
p = await pose();
ok('Enter starts the way down', p.walking && p.t > 0 && p.t < 1, `t ${p.t.toFixed(2)}`);
// Turn back half way: a move you started must stop when you want.
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
const t1 = (await pose()).t;
await page.waitForTimeout(200);
ok('Enter again turns it back at once', (await pose()).t < t1);
await f.waitForFunction(() => window.__block.view.rig.t === 0, null, { timeout: 5000 });
await page.keyboard.press('Enter');
await f.waitForFunction(() => window.__block.view.rig.t === 1, null, { timeout: 6000 });
ok('it lands at eye height', true);
ok('you start in the entrance', (await pose()).place === 'Entrance', (await pose()).place);

// Walking.
const a0 = await pose();
await page.keyboard.down('KeyW');
await page.waitForTimeout(700);
const a1 = await pose();
ok('W walks', Math.hypot(a1.x - a0.x, a1.z - a0.z) > 0.8, `${Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(2)} cells`);
await page.keyboard.up('KeyW');
await page.waitForTimeout(300);
const a2 = await pose();
await page.waitForTimeout(300);
const a3 = await pose();
ok('letting go stops within a third of a second', Math.hypot(a3.x - a2.x, a3.z - a2.z) < 0.01);
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyS');
await page.waitForTimeout(500);
await page.keyboard.up('KeyS');
await page.keyboard.up('ShiftLeft');
ok('S with Shift goes back, faster', Math.hypot((await pose()).x - a3.x, (await pose()).z - a3.z) > 1, '');
const y0 = (await pose()).yaw;
await page.mouse.move(CX + 200, CY, { steps: 5 });
await page.waitForTimeout(60);
ok('the mouse looks around', Math.abs((await pose()).yaw - y0) > 0.05);
const fov0 = (await pose()).fov;
await page.mouse.wheel(0, -300);
await page.waitForTimeout(60);
ok('scroll zooms the view', (await pose()).fov < fov0);

// Esc only lets the mouse go. The browser's own Esc can't be pressed here without taking the real cursor, so the guard's stands in.
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
ok('Esc does not leave the walk', (await pose()).walking);
await f.evaluate(() => document.exitPointerLock());
await page.waitForTimeout(80);
ok('with the mouse let go you are still walking', (await pose()).walking && !(await f.evaluate(() => document.body.classList.contains('locked'))));
ok('it says to click', await f.evaluate(() => getComputedStyle(document.getElementById('grab')).display === 'block'));
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
ok('a second Esc does not leave either', (await pose()).walking);
const m0 = await pose();
await page.keyboard.down('KeyW');
await page.waitForTimeout(400);
await page.keyboard.up('KeyW');
ok('the keys still walk', Math.hypot((await pose()).x - m0.x, (await pose()).z - m0.z) > 0.2);
await page.mouse.move(CX, CY);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(80);
ok('a click takes the mouse back', await f.evaluate(() => document.pointerLockElement === document.getElementById('view')));
// The refusal browsers give for a second after Esc.
await f.evaluate(() => {
	document.exitPointerLock();
	const real = Element.prototype.requestPointerLock;
	window.__refused = 0;
	Element.prototype.requestPointerLock = function () {
		Element.prototype.requestPointerLock = real;
		window.__refused++;
		return Promise.reject(new DOMException('too soon', 'SecurityError'));
	};
});
await page.waitForTimeout(80);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(100);
ok('a refused click is refused', (await f.evaluate(() => window.__refused)) === 1 && !(await f.evaluate(() => document.pointerLockElement)));
await page.waitForTimeout(1500);
ok('then it takes the mouse by itself', await f.evaluate(() => document.pointerLockElement === document.getElementById('view')));

// Into a wall at a run for two seconds, turning: never through it.
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(2000);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
const inWall = await f.evaluate(() => {
	const a = window.__block;
	const d = a.dungeon;
	const c = a.walker.cell();
	const i = c.y * d.W + c.x;
	return d.grid[i] !== 1 && !d.cut[i];
});
ok('a run into a wall stops at the wall', !inWall);

// Back up, and every trigger.
await page.keyboard.press('Enter');
await f.waitForFunction(() => window.__block.view.rig.t === 0, null, { timeout: 5000 });
ok('Enter goes back to the map', true);
const seed0 = (await pose()).seed;
await f.evaluate(() => window.__block.newDungeon());
await f.waitForFunction((s) => window.__block.dungeon.seed !== s, seed0, { timeout: 5000 });
ok('New dungeon forges another', true, String((await pose()).seed));
await f.evaluate(() => window.__block.reset());
await f.waitForFunction((s) => window.__block.dungeon.seed === 1337, seed0, { timeout: 5000 });
p = await pose();
ok('Reset is back at the first dungeon, on the map', p.seed === 1337 && !p.walking && p.t === 0 && p.zoom === 1);
ok('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
demo.close();
shell.close();
const failed = results.filter((r) => !r[0]).length;
console.log(`${results.length - failed} of ${results.length}`);
process.exit(failed ? 1 : 0);
