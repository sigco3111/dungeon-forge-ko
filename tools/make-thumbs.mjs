// The theme pictures and the cover, stills of the demo: node tools/make-thumbs.mjs (after a build). Each thumbnail shows a theme
// at eye height, in the same room, since from above their shapes are alike. Muted, with the pointer-lock guard.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { guard } from 'file:///C:/Users/drini/Patch/seeds/no-pointer-lock.mjs';

guard(chromium);
const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = await createServer({ configFile: path.join(here, 'vite.config.mjs'), server: { port: 5620, host: '127.0.0.1' }, logLevel: 'error' });
await srv.listen();
const CHROME = `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(srv.resolvedUrls.local[0]);
await page.waitForFunction(() => window.__block?.times?.ready > 0, null, { timeout: 90000 });
await page.addStyleTag({ content: '.hud{visibility:hidden!important}' });
const out = path.join(here, 'shots/thumbs');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(here, 'thumbs/themes'), { recursive: true });
const run = (js) => page.evaluate(`(async () => { const a = window.__block; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${js} })()`);
const theme = (th) => `{ const t = a.dungeon; if (a.values.theme !== '${th}') { a.set('theme', '${th}'); await new Promise((r) => { const c = () => (a.dungeon !== t ? r() : setTimeout(c, 20)); c(); }); } }`;
for (const th of ['ancient', 'molten', 'frost', 'grim', 'verdant']) {
	await run(`${theme(th)}
		a.setWalking(true, false); a.view.rig.t = 1;
		const d = a.dungeon, w = a.walker;
		const b = d.rooms.find((q) => q.type === 'boss');
		w.x = b.x0 + 1.6 - d.W / 2; w.z = b.cy + 1.5 - d.H / 2;
		w.yaw = Math.atan2(w.x - (b.cx + 0.5 - d.W / 2), w.z - (b.cy + 0.5 - d.H / 2)); w.pitch = -0.02;
		await sleep(300);`);
	const png = path.join(out, `${th}.png`);
	await page.screenshot({ path: png, clip: { x: 280, y: 0, width: 720, height: 720 } });
	execFileSync('python', ['-I', '-c', `from PIL import Image; Image.open(r'${png}').convert('RGB').resize((224, 224), Image.LANCZOS).save(r'${path.join(here, 'thumbs/themes', `${th}.webp`)}', quality=82, method=6)`]);
}
// The cover: the molten dungeon from above, a little closer than the opening.
await run(`${theme('molten')} a.setWalking(false, false); a.view.rig.t = 0; a.view.rig.zoom = 1.05; await sleep(400);`);
await page.screenshot({ path: path.join(here, 'shots/cover-map.png') });
await run(`a.setWalking(true, false); a.view.rig.t = 1; const d = a.dungeon, w = a.walker;
	const big = d.rooms.filter((q) => q.type === 'combat').sort((p, q) => q.w * q.h - p.w * p.h)[0];
	w.x = big.x0 + 1.6 - d.W / 2; w.z = big.y0 + 1.6 - d.H / 2; w.yaw = Math.atan2(w.x - (big.cx + 0.5 - d.W / 2), w.z - (big.cy + 0.5 - d.H / 2)); w.pitch = 0; await sleep(300);`);
await page.screenshot({ path: path.join(here, 'shots/cover-walk.png') });
await browser.close();
await srv.close();
process.exit(0);
