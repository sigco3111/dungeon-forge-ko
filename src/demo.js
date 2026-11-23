// The block demo: forge a dungeon, see it from above, press Enter and walk it. Everything heavy is in the worker.
import { patchBlock } from 'patch-block';
import * as THREE from 'three';
import recipe from '../recipe.json';
import { THEME_NAMES } from './generator.js';
import { THEMES, ROLE_TINT } from './themes.js';
import { createView } from './view.js';
import { createWalker } from './walker.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const cover = $('cover');
const times = { start: performance.now(), ready: 0 };
const app = { times };
window.__block = app;

const defaults = Object.fromEntries(recipe.block.controls.map((c) => [c.id, c.default]));
const v = { ...defaults };
const paramsOf = () => ({ seed: v.seed, rooms: v.rooms, loops: v.loops / 100, decor: v.decor / 100, theme: v.theme, heat: v.heat });

let view = null;
let dungeon = null;
let walker = null;
let levelId = 0;
let inFlight = false;
let queued = null;
let walking = false; // where rig.t is heading
let visible = true;
let warm = false;
const worker = new Worker(new URL('./build-worker.js', import.meta.url), { type: 'module' });

const block = patchBlock({
	...recipe.block,
	onSet(id, value) {
		if (v[id] === value) return;
		v[id] = value;
		set(id);
	},
	onTrigger(id) {
		if (id === 'new') newDungeon();
		if (id === 'walk') toggleWalk(false);
		if (id === 'reset') reset();
	},
	onVisible(on) {
		visible = on;
		if (!on) releaseKeys();
	},
});

function set(id) {
	if (id === 'theme' || id === 'rooms' || id === 'loops' || id === 'seed' || id === 'decor' || id === 'heat') requestLevel({ keepPlace: id === 'theme' || id === 'decor' || id === 'heat' });
	else if (['props', 'torches', 'particles', 'liquids', 'lights'].includes(id)) view.layers[id] = v[id];
	else if (id === 'view') setWalking(v.view === 'walk', false);
	else if (id === 'graph') view.setGraph(dungeon, v.graph);
	else applyLook();
}
function applyLook() {
	view.POST.fin.uniforms.uBloom.value = v.bloom;
	view.rig.tiltOn = v.tilt;
	view.rig.light = v.light;
}

function newDungeon() {
	v.seed = 1 + Math.floor(Math.random() * 999998);
	block.state({ seed: v.seed });
	panelSync();
	requestLevel({ reveal: !walking, keepPlace: false });
}
function reset() {
	const changes = {};
	for (const [k, d] of Object.entries(defaults)) if (v[k] !== d) {
		v[k] = d;
		changes[k] = d;
	}
	if (Object.keys(changes).length) block.state(changes);
	for (const k of ['props', 'torches', 'particles', 'liquids', 'lights']) view.layers[k] = v[k];
	panelSync();
	setWalking(false, false);
	Object.assign(view.rig, { yaw: Math.PI / 4, pitch: 0.64, fov: 72 });
	applyLook();
	view.setGraph(dungeon, v.graph);
	requestLevel({ keepPlace: false });
}

function requestLevel(opts = {}) {
	const job = { params: paramsOf(), opts };
	if (inFlight) {
		// Only the latest counts, but a request to start over must not be lost to a recolour.
		if (queued && queued.opts.keepPlace === false) opts.keepPlace = false;
		if (queued?.opts.reveal) opts.reveal = true;
		queued = job;
		return;
	}
	send(job);
}
function send(job) {
	inFlight = job;
	worker.postMessage({ type: 'level', id: ++levelId, params: job.params });
}
worker.onmessage = ({ data }) => {
	if (data.type === 'masonry') {
		view.setMasonry(data);
		app.onMasonry?.();
		return;
	}
	const job = inFlight;
	inFlight = false;
	const next = queued;
	queued = null;
	if (next) {
		if (!job.opts.keepPlace) next.opts.keepPlace = false;
		send(next);
		// A stale level is skipped, but a slider held still still lands the newest.
		return;
	}
	install(data.dungeon, data.level, job.opts);
	app.lastBuild = data.ms;
	app.onLevel?.();
};
worker.onerror = (e) => fail('던전 생성기를 시작하지 못했습니다.', e.message ?? '');

function install(d, level, opts) {
	const keep = opts.keepPlace && walker;
	const pose = keep ? { x: walker.x, z: walker.z, yaw: walker.yaw, pitch: walker.pitch } : null;
	dungeon = d;
	view.setLevel(d, level, { reveal: opts.reveal && warm });
	view.setGraph(d, v.graph);
	walker = createWalker(d);
	walker.start();
	if (pose) Object.assign(walker, pose);
	else {
		view.frameMap(d);
		if (walking) view.rig.t = 1;
	}
	syncEye();
	drawMinimap();
	lastRoom = undefined;
	$('name').textContent = d.name;
	document.documentElement.style.setProperty('--accent', THEMES[d.params.theme].accent);
	$('facts').textContent = `시드 ${d.seed} · 방 ${d.stats.rooms}개 · 보스까지 ${d.stats.critLen}개 방 · 순환로 ${d.stats.loops}개`;
	app.stats = d.stats;
	app.dungeon = d;
	app.walker = walker;
}

function setWalking(on, tellPage = true) {
	if (walking === on) return;
	walking = on;
	v.view = on ? 'walk' : 'map';
	if (tellPage) block.state({ view: v.view });
	if (!on) {
		releaseKeys();
		if (document.pointerLockElement) document.exitPointerLock();
	}
	document.body.classList.toggle('walking', on);
}
function toggleWalk(gesture) {
	setWalking(!walking);
	canvas.focus();
	if (walking && gesture) lock();
}
let retry = 0;
function lock() {
	if (document.pointerLockElement === canvas || !canvas.requestPointerLock) return;
	// Browsers refuse the mouse for about a second after Esc. Ask once more when that has passed, or the click would seem to do nothing.
	const later = () => {
		if (!retry) retry = setTimeout(() => {
			retry = 0;
			if (walking && document.pointerLockElement !== canvas) canvas.requestPointerLock()?.catch?.(() => {});
		}, 1300);
	};
	try {
		canvas.requestPointerLock()?.catch?.(later);
	} catch {
		later();
	}
}

// Input. Held keys only: let go and you stop.
const keys = new Set();
function releaseKeys() {
	keys.clear();
	for (const k of document.querySelectorAll('kbd.down')) k.classList.remove('down');
}
addEventListener('keydown', (e) => {
	if (e.target.closest?.('#panel, #ptoggle')) return; // typing in the panel is not walking
	if (e.code === 'Enter') {
		if (!e.repeat) toggleWalk(true);
		e.preventDefault();
		return;
	}
	if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'].includes(e.code)) {
		keys.add(e.code);
		e.preventDefault();
		document.querySelector(`kbd[data-key="${e.code}"]`)?.classList.add('down');
	}
});
addEventListener('keyup', (e) => {
	if (e.target.closest?.('#panel')) return;
	keys.delete(e.code);
	document.querySelector(`kbd[data-key="${e.code}"]`)?.classList.remove('down');
});
addEventListener('blur', releaseKeys);
canvas.addEventListener('focus', () => document.body.classList.add('awake'));
canvas.addEventListener('blur', () => {
	document.body.classList.remove('awake');
	releaseKeys();
});

// The browser's Esc lets the mouse go and that's all it does: you're still walking, and a click takes the mouse back.
document.addEventListener('pointerlockchange', () => {
	const on = document.pointerLockElement === canvas;
	document.body.classList.toggle('locked', on);
	if (!on) releaseKeys();
});
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
	canvas.focus();
	const orbit = e.button === 2 || (e.button === 0 && e.shiftKey);
	drag = { x: e.clientX, y: e.clientY, orbit, moved: 0 };
	canvas.setPointerCapture(e.pointerId);
	canvas.classList.add('drag');
	if (e.pointerType === 'touch' && walking) touchWalk = { at: performance.now(), held: true };
});
canvas.addEventListener('pointermove', (e) => {
	if (document.pointerLockElement === canvas) {
		look(e.movementX, e.movementY);
		return;
	}
	if (!drag) return;
	const dx = e.clientX - drag.x;
	const dy = e.clientY - drag.y;
	drag.x = e.clientX;
	drag.y = e.clientY;
	drag.moved += Math.abs(dx) + Math.abs(dy);
	if (walking) {
		look(dx * 1.4, dy * 1.4);
		return;
	}
	const r = view.rig;
	if (drag.orbit) {
		r.yaw -= dx * 0.005;
		r.pitch = Math.min(1.25, Math.max(0.32, r.pitch + dy * 0.005));
	} else {
		const fit = Math.max(r.fitX / r.aspect, r.fitY, 8) / r.zoom;
		const wpp = (2 * fit) / canvas.clientHeight;
		const fx = Math.sin(r.yaw);
		const fz = Math.cos(r.yaw);
		r.target.x += (-dx * fz - (dy * fx) / Math.sin(r.pitch)) * wpp;
		r.target.z += (dx * fx - (dy * fz) / Math.sin(r.pitch)) * wpp;
	}
});
const endDrag = (e) => {
	if (drag && walking && drag.moved < 5 && e.type === 'pointerup' && e.pointerType === 'mouse') lock();
	drag = null;
	touchWalk = null;
	canvas.classList.remove('drag');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
	'wheel',
	(e) => {
		e.preventDefault();
		const r = view.rig;
		if (walking) r.fov = Math.min(92, Math.max(38, r.fov * Math.exp(e.deltaY * 0.0009)));
		else r.zoom = Math.min(7, Math.max(0.5, r.zoom * Math.exp(-e.deltaY * 0.0012)));
	},
	{ passive: false },
);
let touchWalk = null;
function look(dx, dy) {
	if (!walker) return;
	const k = 0.0021 * (view.rig.fov / 72);
	walker.yaw -= dx * k;
	walker.pitch = Math.max(-1.35, Math.min(1.35, walker.pitch - dy * k));
}

// The small map you carry.
const mini = $('mini');
const mctx = mini.getContext('2d');
let miniBase = null;
function drawMinimap() {
	const d = dungeon;
	const c = document.createElement('canvas');
	c.width = d.W;
	c.height = d.H;
	const g = c.getContext('2d');
	const img = g.createImageData(d.W, d.H);
	for (let i = 0; i < d.W * d.H; i++) {
		const j = i * 4;
		const t = d.grid[i];
		if (t === 0) continue;
		const room = d.roomId[i] >= 0 ? d.rooms[d.roomId[i]] : null;
		const tint = room && room.type !== 'combat' ? ROLE_TINT[room.type] : t === 1 ? 0xa8a8b0 : 0x3c3c44;
		img.data[j] = (tint >> 16) & 255;
		img.data[j + 1] = (tint >> 8) & 255;
		img.data[j + 2] = tint & 255;
		img.data[j + 3] = t === 1 ? 200 : 110;
	}
	g.putImageData(img, 0, 0);
	miniBase = c;
}
function paintMinimap() {
	if (!miniBase) return;
	const d = dungeon;
	const S = mini.width;
	mctx.clearRect(0, 0, S, S);
	const span = 44; // cells across
	const k = S / span;
	mctx.save();
	mctx.beginPath();
	mctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
	mctx.clip();
	mctx.fillStyle = 'rgba(8,9,12,0.72)';
	mctx.fillRect(0, 0, S, S);
	mctx.imageSmoothingEnabled = false;
	const cx = walker.x + d.W / 2;
	const cy = walker.z + d.H / 2;
	mctx.translate(S / 2, S / 2);
	mctx.rotate(walker.yaw);
	mctx.drawImage(miniBase, -cx * k, -cy * k, d.W * k, d.H * k);
	mctx.restore();
	mctx.fillStyle = '#fff';
	mctx.beginPath();
	mctx.moveTo(S / 2, S / 2 - 7);
	mctx.lineTo(S / 2 + 5, S / 2 + 5);
	mctx.lineTo(S / 2, S / 2 + 2);
	mctx.lineTo(S / 2 - 5, S / 2 + 5);
	mctx.closePath();
	mctx.fill();
}

const ROLE_WORD = { entrance: '입구', combat: '전투 방', elite: '정예 방', treasure: '보물 방', shrine: '성소', boss: '보스 방' };
let lastRoom;
function syncEye() {
	const r = view.rig;
	r.eye.set(walker.x, 1.07 + Math.sin(walker.bob) * 0.012, walker.z);
	r.eyeYaw = walker.yaw;
	r.eyePitch = walker.pitch;
}
function fail(title, why) {
	$('nogl').classList.add('on');
	$('nogl').querySelector('h1').textContent = title;
	$('nogl').querySelector('small').textContent = why;
	cover.classList.add('off');
	block.ready();
}


// ---- Korean edition: settings panel, built from the recipe so the labels live in one place. ----
const panelEl = $('panel');
const inputs = {};
function panelSync() {
	for (const [id, el] of Object.entries(inputs)) {
		if (el.type === 'checkbox') el.checked = Boolean(v[id]);
		else el.value = v[id];
		if (el.out) el.out.textContent = fmt(id, v[id]);
	}
}
const ctl = (id) => recipe.block.controls.find((c) => c.id === id);
const fmt = (id, val) => {
	const c = ctl(id);
	return c?.unit === '%' ? `${val}%` : c?.unit === '×' ? `${Number(val).toFixed(2)}×` : c?.step < 1 ? Number(val).toFixed(2) : String(val);
};
function buildPanel() {
	const h2 = (t) => `<h2>${t}</h2>`;
	panelEl.innerHTML = `${h2('던전 설정')}<div id="rows"></div><div class="btns"><button class="go" data-t="walk" type="button">걸어 보기</button><button data-t="new" type="button">새 던전</button><button data-t="reset" type="button">초기화</button></div><hr>${h2('보기 · 개별 요소 표시')}<div class="tg" id="tg"></div><div class="note">히트맵: 초록(쉬움) → 빨강(어려움)</div><hr>${h2('생성 통계')}<div id="stats"></div>`;
	const rows = panelEl.querySelector('#rows');
	const tg = panelEl.querySelector('#tg');
	for (const c of recipe.block.controls) {
		if (c.id === 'view') continue;
		let el;
		if (c.type === 'toggle') {
			const lab = document.createElement('label');
			lab.title = c.hint;
			el = document.createElement('input');
			el.type = 'checkbox';
			lab.append(el, c.label);
			tg.append(lab);
			el.onchange = () => commit(c.id, el.checked);
		} else {
			const row = document.createElement('div');
			row.className = 'row';
			const lab = document.createElement('label');
			lab.textContent = c.label;
			lab.title = c.hint;
			row.append(lab);
			if (c.type === 'choice') {
				el = document.createElement('select');
				for (const o of c.options) el.add(new Option(o.label, o.value));
				el.onchange = () => commit(c.id, el.value);
				row.append(el);
			} else if (c.id === 'seed') {
				el = document.createElement('input');
				el.type = 'number';
				Object.assign(el, { min: c.min, max: c.max, step: 1 });
				el.onchange = () => {
					const n = Math.round(Number(el.value));
					if (Number.isFinite(n) && n >= c.min && n <= c.max) commit('seed', n);
					else el.value = v.seed;
				};
				row.append(el);
			} else {
				el = document.createElement('input');
				el.type = 'range';
				Object.assign(el, { min: c.min, max: c.max, step: c.step });
				const out = document.createElement('output');
				el.out = out;
				el.oninput = () => {
					out.textContent = fmt(c.id, el.value);
					commit(c.id, Number(el.value));
				};
				row.append(el, out);
			}
			row.title = c.hint;
			rows.append(row);
		}
		inputs[c.id] = el;
	}
	panelEl.querySelectorAll('button[data-t]').forEach((b) => (b.onclick = () => {
		const t = b.dataset.t;
		if (t === 'new') newDungeon();
		if (t === 'walk') toggleWalk(false);
		if (t === 'reset') reset();
		canvas.focus();
	}));
	panelSync();
}
function commit(id, value) {
	if (v[id] === value) return;
	v[id] = value;
	set(id);
}
buildPanel();
const ptoggle = $('ptoggle');
ptoggle.onclick = () => panelEl.classList.toggle('shut');
if (innerWidth < 720) panelEl.classList.add('shut');
let statsAt = 0;
function paintStats(now, info) {
	if (now - statsAt < 500 || !app.stats) return;
	statsAt = now;
	const s = app.stats;
	const b = app.lastBuild;
	$('stats').textContent = [
		`방 ${s.rooms} · 연결 ${s.edges} · 순환 ${s.loops}`,
		`최단 경로 ${s.critLen}개 방 · 바닥 ${s.floorTiles}칸`,
		b ? `생성 ${b.generate.toFixed(0)}ms · 조명/배치 ${b.dress.toFixed(0)}ms` : '',
		`그리기 ${info.calls}회 · 삼각형 ${Math.round(info.triangles / 1000)}k`,
		`FPS ${Math.round(1000 / Math.max(1, frameAvg))}`,
	].join('\n');
}

// Frame.
let last = performance.now();
let time = 0;
let slowFor = 0;
let frameAvg = 16;
function tick(now) {
	requestAnimationFrame(tick);
	if (!visible || !view || !dungeon) {
		last = now;
		return;
	}
	const dt = Math.min((now - last) / 1000, 0.05);
	const raw = now - last;
	last = now;
	time += dt;
	const r = view.rig;
	const goal = walking ? 1 : 0;
	if (r.t !== goal) r.t = goal > r.t ? Math.min(1, r.t + dt / 1.9) : Math.max(0, r.t - dt / 1.5);
	if (walking && r.t >= 1 && walker) {
		const f = (keys.has('KeyW') || keys.has('ArrowUp') || touchWalk ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
		const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
		const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
		walker.step(dt, f, s, run ? 4.4 : 2.9);
		syncEye();
		const room = walker.room();
		const id = room ? room.id : -1;
		if (id !== lastRoom) {
			lastRoom = id;
			const place = $('place');
			place.textContent = room ? ROLE_WORD[room.type] : '복도';
			place.style.setProperty('--role', room ? `#${ROLE_TINT[room.type].toString(16).padStart(6, '0')}` : 'rgba(255,255,255,0.65)');
			app.lastPlace = place.textContent;
		}
		paintMinimap();
	} else if (walker && r.t > 0.6) {
		syncEye();
		paintMinimap();
	}
	view.renderer.info.reset();
	view.frame(time, dt);
	paintStats(now, view.renderer.info.render);
	// Hold the frame rate on a slow card by drawing fewer pixels.
	// A gap this long is a covered window or a stall, not a slow card: browsers run a covered window at one frame a second.
	if (warm && document.visibilityState === 'visible' && raw < 400) {
		frameAvg += (raw - frameAvg) * 0.05;
		slowFor = frameAvg > 26 ? slowFor + raw : 0;
		if (slowFor > 1600 && view.pixelCap > 0.7) {
			view.setPixelCap(Math.max(0.7, Math.min(view.pixelCap, view.renderer.getPixelRatio()) * 0.82));
			slowFor = 0;
			frameAvg = 16;
			app.pixelCap = view.pixelCap;
		}
	}
}

addEventListener('resize', () => view?.resize());

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
async function gpuCaughtUp(gl) {
	const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
	gl.flush();
	const t0 = performance.now();
	while (performance.now() - t0 < 4000) {
		const s = gl.clientWaitSync(fence, 0, 0);
		if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED) break;
		await nextFrame();
	}
	gl.deleteSync(fence);
}

async function start() {
	try {
		view = createView(canvas, { pixelCap: Math.min(devicePixelRatio, 1.25) });
	} catch (e) {
		fail('이 던전은 WebGL을 지원하는 그래픽이 필요합니다.', e?.message ?? '');
		return;
	}
	app.view = view;
	view.renderer.info.autoReset = false;
	app.renderer = view.renderer;
	applyLook();
	block.progress(0.1, 'Cutting the stone');
	await new Promise((res) => {
		app.onMasonry = res;
		worker.postMessage({ type: 'masonry' });
	});
	block.progress(0.4, 'Forging the dungeon');
	await new Promise((res) => {
		app.onLevel = res;
		requestLevel({});
	});
	app.onLevel = null;
	block.progress(0.6, 'Lighting the torches');
	// Compile everything the two views can reach before anything shows, then draw each once under the cover.
	const renderer = view.renderer;
	const dummy = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), null);
	const liquidMat = view.drawMaterials.find((m) => m.uniforms?.uMode);
	dummy.material = liquidMat;
	dummy.frustumCulled = false;
	dummy.visible = true;
	view.scene.add(dummy);
	for (const m of Object.values(view.meshes)) m.visible = true;
	view.rig.t = 1;
	await renderer.compileAsync(view.scene, view.camera);
	block.progress(0.75, 'Lighting the torches');
	view.frame(0, 0);
	await nextFrame();
	view.rig.t = 0.5;
	view.frame(0, 0);
	await nextFrame();
	view.scene.remove(dummy);
	dummy.geometry.dispose();
	view.rig.t = 0;
	for (let i = 0; i < 3; i++) {
		view.frame(0, 0);
		await nextFrame();
	}
	await gpuCaughtUp(renderer.getContext());
	block.progress(0.9, 'Lighting the torches');
	warm = true;
	last = performance.now();
	requestAnimationFrame(tick);
	// Settle in view of the page's loader, then open. Showing the canvas first and saying ready after avoids a stall at the reveal.
	for (const el of document.querySelectorAll('.hud')) el.classList.add('on');
	cover.classList.add('off');
	const t0 = performance.now();
	let good = 0;
	let prev = performance.now();
	for (let i = 0; i < 240 && good < 20 && performance.now() - t0 < 4000; i++) {
		await nextFrame();
		const n = performance.now();
		good = n - prev < 34 ? good + 1 : 0;
		prev = n;
	}
	times.ready = performance.now() - times.start;
	block.ready();
}

// Theme names come from the recipe's pictures; checked here so the recipe and the generator can't drift apart.
for (const o of recipe.block.controls.find((c) => c.id === 'theme').options) if (!THEME_NAMES.includes(o.value)) console.error(`Unknown theme ${o.value}`);
const hasGL = (() => {
	try {
		return Boolean(document.createElement('canvas').getContext('webgl2'));
	} catch {
		return false;
	}
})();
if (!hasGL) fail('This demo needs a graphics card', "This browser can't give it WebGL 2. It plays in Patch Desktop, and in any recent browser with hardware acceleration turned on.");
else start();

// For tests and agents driving the demo from the page.
Object.assign(app, { set: (id, value) => {
	if (v[id] === value) return;
	v[id] = value;
	set(id);
}, newDungeon, reset, setWalking, isWalking: () => walking, values: v, keys });
