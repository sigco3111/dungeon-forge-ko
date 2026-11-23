// Turns a generated dungeon into what the view draws, as plain typed arrays: instance lists, liquid and particle buffers,
// wall corners to cut, ceiling heights and the baked light. No three.js or DOM, so it runs in the worker and a rebuild never
// stalls a frame. Instance lists follow Dungeon Forge's dressing (Majid Manzarpour, MIT); ceilings, cut corners, the plinth
// and the light field are Patch's, for walking inside.
import { FLOOR, POOL, WALL } from './generator.js';
import { ROLE_TINT, THEMES } from './themes.js';

// Cell ceiling heights, in cells (1.5 m each at human scale).
export const CEIL_TOP = 5.4;
const CEILING = { s: 2.7, m: 3.2, l: 3.9, boss: 4.5, corridor: 2.25 };

const lin = (c) => (c < 0.04045 ? c * 0.0773993808 : ((c * 0.9478672986 + 0.0521327014) ** 2.4));
const rgb = (hex) => [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// A list of instances: column-major matrices with Euler XYZ rotation, as three composes them.
class List {
	constructor() {
		this.m = [];
		this.c = [];
		this.n = 0;
	}

	add(x, y, z, sx, sy, sz, ry, color, rx = 0, rz = 0) {
		const a = Math.cos(rx);
		const b = Math.sin(rx);
		const c = Math.cos(ry);
		const d = Math.sin(ry);
		const e = Math.cos(rz);
		const f = Math.sin(rz);
		const ae = a * e;
		const af = a * f;
		const be = b * e;
		const bf = b * f;
		this.m.push(c * e * sx, (af + be * d) * sx, (bf - ae * d) * sx, 0, -c * f * sy, (ae - bf * d) * sy, (be + af * d) * sy, 0, d * sz, -b * c * sz, a * c * sz, 0, x, y, z, 1);
		this.c.push(color[0], color[1], color[2]);
		this.n++;
	}

	done() {
		return { n: this.n, m: new Float32Array(this.m), c: new Float32Array(this.c) };
	}
}

// Which wall cells get a corner cut, so round and eight-sided rooms have slanted walls and not stairs. A wall cell with floor
// on two sides that meet at a corner, with no torch or banner on it and no arch beside it. 0 = keep, else 1 + a rotation index.
function cutCorners(d) {
	const { W, H, grid, doorway } = d;
	const cut = new Uint8Array(W * H);
	const hung = new Set();
	for (const t of d.torches) hung.add(t.y * W + t.x);
	for (const p of d.props) if (p.kind === 'banner' || p.kind === 'roots' || p.kind === 'icicle') hung.add(p.y * W + p.x);
	for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
		const c = y * W + x;
		if (grid[c] !== WALL || hung.has(c)) continue;
		const E = grid[c + 1] === FLOOR;
		const W_ = grid[c - 1] === FLOOR;
		const S = grid[c + W] === FLOOR;
		const N = grid[c - W] === FLOOR;
		if (E + W_ + S + N !== 2 || (E && W_) || (S && N)) continue;
		let nearDoor = false;
		for (let oy = -1; oy <= 1 && !nearDoor; oy++) for (let ox = -1; ox <= 1; ox++) if (doorway[c + oy * W + ox]) {
			nearDoor = true;
			break;
		}
		if (nearDoor) continue;
		// The rotation that turns the removed corner (+x, +z) towards the two floors.
		cut[c] = E ? (S ? 1 : 2) : N ? 3 : 4;
	}
	return cut;
}

const CUT_RY = [0, 0, Math.PI / 2, Math.PI, -Math.PI / 2];

// The light field: a top-down picture of every lamp's light that stops at walls, sampled by every material. All torches light
// the level for the cost of two texture reads, nothing leaks through a wall, and it costs nothing on a slow GPU. RGB is light
// (square-root encoded), A how open the floor is (ambient occlusion). A second picture holds the mean direction to the light.
export function bakeField(d, theme) {
	const TH = THEMES[theme];
	const { W, H, grid } = d;
	const K = 3;
	const fw = W * K;
	const fh = H * K;
	const open = new Float32Array(W * H);
	for (let i = 0; i < W * H; i++) open[i] = grid[i] === FLOOR || grid[i] === POOL || d.cut[i] ? 1 : 0;
	for (const p of d.props) if (p.radius > 0.2) open[p.y * W + p.x] = Math.min(open[p.y * W + p.x], p.kind === 'pillar' ? 0.68 : 0.82);

	const lamps = [];
	// Fire is never one pure colour on stone: every lamp leans towards warm white, so a theme tints the light and doesn't paint it.
	const soft = (c, k = 0.42) => mix(c, mul([1, 0.86, 0.68], c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1), k);
	const torch = soft(rgb(TH.torchLight[0]));
	const wx = (x) => x + 0.5;
	for (const t of d.torches) lamps.push({ x: wx(t.x) + t.dx * 0.62, y: wx(t.y) + t.dy * 0.62, c: torch, i: TH.torchLight[1] * 1.3, r: 11 });
	for (const p of d.props) {
		if (p.kind === 'brazier') lamps.push({ x: wx(p.x), y: wx(p.y), c: soft(rgb(TH.flame)), i: 1.7, r: 11 });
		else if (p.kind === 'candle') lamps.push({ x: wx(p.x), y: wx(p.y), c: soft(rgb(TH.flame)), i: 0.35, r: 5 });
		else if (p.kind === 'chest') lamps.push({ x: wx(p.x), y: wx(p.y), c: rgb(0xffc060), i: 0.5, r: 6 });
	}
	for (const r of d.rooms) {
		if (r.type === 'entrance') lamps.push({ x: wx(r.cx), y: wx(r.cy), c: rgb(ROLE_TINT.entrance), i: 1.2, r: 12 });
		if (r.type === 'boss') lamps.push({ x: wx(r.cx), y: wx(r.cy), c: soft(rgb(0xff4030), 0.2), i: 2.6, r: 20 });
		if (r.type === 'shrine') lamps.push({ x: wx(r.cx), y: wx(r.cy), c: rgb(0x6f9dff), i: 1.5, r: 11 });
		if (r.type === 'elite') lamps.push({ x: wx(r.cx), y: wx(r.cy), c: rgb(0x9b6cf0), i: 0.7, r: 9 });
	}
	if (TH.pools?.light) {
		const c = soft(rgb(TH.pools.light), 0.25);
		const i = TH.pools.mode === 0 ? 0.75 : 0.3;
		for (const p of d.pools) lamps.push({ x: wx(p.x), y: wx(p.y), c, i, r: 6 });
	}

	const R = new Float32Array(fw * fh);
	const G = new Float32Array(fw * fh);
	const B = new Float32Array(fw * fh);
	const DX = new Float32Array(fw * fh);
	const DY = new Float32Array(fw * fh);
	const DW = new Float32Array(fw * fh);
	for (const L of lamps) {
		const x0 = Math.max(0, Math.floor((L.x - L.r) * K));
		const x1 = Math.min(fw - 1, Math.ceil((L.x + L.r) * K));
		const y0 = Math.max(0, Math.floor((L.y - L.r) * K));
		const y1 = Math.min(fh - 1, Math.ceil((L.y + L.r) * K));
		const lum = L.c[0] * 0.3 + L.c[1] * 0.6 + L.c[2] * 0.1;
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
			const px = (x + 0.5) / K;
			const py = (y + 0.5) / K;
			const dx = px - L.x;
			const dy = py - L.y;
			const q = dx * dx + dy * dy;
			if (q > L.r * L.r) continue;
			const dist = Math.sqrt(q);
			const win = 1 - q / (L.r * L.r);
			const atten = (L.i * win * win) / (1 + q * 0.2);
			if (atten < 0.004) continue;
			// March the cells between the lamp and this point.
			let through = 1;
			const steps = Math.ceil(dist * 2.5);
			for (let s = 1; s < steps; s++) {
				const f = s / steps;
				through *= open[Math.floor(L.y + dy * f) * W + Math.floor(L.x + dx * f)];
				if (through <= 0.001) break;
			}
			if (through <= 0.001) continue;
			const e = atten * through;
			const i = y * fw + x;
			R[i] += L.c[0] * e;
			G[i] += L.c[1] * e;
			B[i] += L.c[2] * e;
			const w = e * lum;
			const n = dist > 0.01 ? 1 / dist : 0;
			DX[i] -= dx * n * w;
			DY[i] -= dy * n * w;
			DW[i] += w;
		}
	}

	// A small blur softens the hard edges of the cell-by-cell shadows. Encoded with a square root so dark gradients don't band.
	const blur = (src) => {
		const a = new Float32Array(fw * fh);
		for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
			const l = src[y * fw + Math.max(0, x - 1)];
			const r = src[y * fw + Math.min(fw - 1, x + 1)];
			a[y * fw + x] = (l + r + src[y * fw + x] * 2) * 0.25;
		}
		const b = new Float32Array(fw * fh);
		for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
			const u = a[Math.max(0, y - 1) * fw + x];
			const v = a[Math.min(fh - 1, y + 1) * fw + x];
			b[y * fw + x] = (u + v + a[y * fw + x] * 2) * 0.25;
		}
		return b;
	};
	const [r, g, b, ddx, ddy, ddw] = [R, G, B, DX, DY, DW].map(blur);

	// Openness: how far the nearest wall is, up to a cell away.
	const aoRaw = new Float32Array(fw * fh);
	for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
		const cx = (x + 0.5) / K;
		const cy = (y + 0.5) / K;
		const ix = Math.floor(cx);
		const iy = Math.floor(cy);
		let near = 1.1;
		for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
			const nx = ix + ox;
			const ny = iy + oy;
			if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
			const c = ny * W + nx;
			if (grid[c] === FLOOR || grid[c] === POOL) continue;
			const qx = Math.max(nx - cx, 0, cx - nx - 1);
			const qy = Math.max(ny - cy, 0, cy - ny - 1);
			near = Math.min(near, Math.hypot(qx, qy));
		}
		aoRaw[y * fw + x] = near;
	}
	const color = new Uint8Array(fw * fh * 4);
	const dir = new Uint8Array(fw * fh * 4);
	const EMAX = 4;
	for (let i = 0; i < fw * fh; i++) {
		const j = i * 4;
		color[j] = Math.min(255, Math.sqrt(r[i] / EMAX) * 255);
		color[j + 1] = Math.min(255, Math.sqrt(g[i] / EMAX) * 255);
		color[j + 2] = Math.min(255, Math.sqrt(b[i] / EMAX) * 255);
		const near = Math.min(1, aoRaw[i] / 0.9);
		color[j + 3] = (0.3 + 0.7 * near * (2 - near)) * 255;
		const w = ddw[i] > 1e-5 ? 1 / ddw[i] : 0;
		const lx = ddx[i] * w;
		const ly = ddy[i] * w;
		const focus = Math.min(1, Math.hypot(lx, ly));
		dir[j] = (lx * 0.5 + 0.5) * 255;
		dir[j + 1] = (ly * 0.5 + 0.5) * 255;
		dir[j + 2] = focus * 255;
		dir[j + 3] = 255;
	}
	return { w: fw, h: fh, color, dir, lamps: lamps.length };
}

export function buildLevel(d, opts = {}) {
	const theme = d.params.theme;
	const TH = THEMES[theme];
	const { W, H, grid, roomId, corridor, doorway, rooms, lakeMask } = d;
	d.cut = cutCorners(d);
	const idx = (x, y) => y * W + x;
	const wx = (x) => x - W / 2 + 0.5;
	const wz = (y) => y - H / 2 + 0.5;
	let state = (d.seed ^ 0x9e3779b9) >>> 0;
	const raw = () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const f = (a, b) => a + raw() * (b - a);
	const pick4 = () => Math.floor(raw() * 4);
	const C = {};
	for (const k of ['floor', 'corridor', 'wall', 'cap', 'pillar', 'cloth', 'flame', 'flameCore']) C[k] = rgb(TH[k]);
	const accent = rgb(Number.parseInt(TH.accent.slice(1), 16));
	const hex = (h) => rgb(h);

	const names = ['floor', 'wall', 'wallCut', 'wallCap', 'capCut', 'ceiling', 'beam', 'plinth', 'pillar', 'arch', 'archL', 'torchArm', 'flame', 'debrisA', 'debrisB', 'debrisC', 'chest', 'chestTrim', 'chestGlow', 'grave', 'sarco', 'candle', 'bone', 'icicle', 'shardIce', 'roots', 'moss', 'crackD', 'skirt', 'bannerRod', 'bannerCloth', 'emblem', 'spawn1', 'spawn2', 'spawn3', 'band2', 'band3', 'crystal', 'markGem', 'ring', 'plinthS', 'post', 'platform', 'brazier', 'coals', 'basin', 'bossGlow', 'bossRock'];
	const S = {};
	for (const n of names) S[n] = new List();

	const poolAdj = (x, y) => {
		const c = idx(x, y);
		return (x < W - 1 && grid[c + 1] === POOL) || (x > 0 && grid[c - 1] === POOL) || (y < H - 1 && grid[c + W] === POOL) || (y > 0 && grid[c - W] === POOL);
	};
	const mossMask = new Uint8Array(W * H);
	for (const p of d.props) if (p.kind === 'moss') mossMask[idx(p.x, p.y)] = 1;

	// Floors. Tiles stand on a dark slab (the view's), so the seams read as mortar and not as holes.
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const c = idx(x, y);
		if (grid[c] !== FLOOR || lakeMask[c]) {
			if (d.cut[c]) S.floor.add(wx(x), f(-0.02, 0.008), wz(y), 1, 1, 1, 0, mul(C.corridor, 0.8));
			continue;
		}
		let walls8 = 0;
		for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
			if (!ox && !oy) continue;
			const nx = x + ox;
			const ny = y + oy;
			if (nx < 0 || ny < 0 || nx >= W || ny >= H || grid[idx(nx, ny)] === WALL) walls8++;
		}
		const rid = roomId[c];
		let base = corridor[c] ? C.corridor : C.floor;
		if (rid >= 0 && rooms[rid].type !== 'combat') base = mix(base, hex(ROLE_TINT[rooms[rid].type]), 0.17);
		// Difficulty heat map (Korean edition, from Dungeon Forge's overlay): green is easy, red is hard.
		if (opts.heat && rid >= 0) {
			const k = Math.max(0, Math.min(1, rooms[rid].difficulty));
			const heat = k < 0.5 ? mix([0.2, 0.75, 0.3], [0.95, 0.85, 0.2], k * 2) : mix([0.95, 0.85, 0.2], [0.9, 0.2, 0.15], (k - 0.5) * 2);
			base = mix(base, heat, 0.62);
		}
		if (doorway[c]) base = mul(base, 1.14);
		if (mossMask[c]) base = mix(base, hex(0x4c7a42), 0.32);
		if (TH.pools && TH.pools.mode === 0 && poolAdj(x, y)) base = mix(base, hex(0xff7a33), 0.3);
		base = mul(base, 1 - 0.11 * Math.min(walls8, 4));
		base = mul(base, (x + y) & 1 ? 0.965 : 1);
		base = mul(base, f(0.94, 1.06));
		S.floor.add(wx(x), f(-0.02, 0.008), wz(y), 1, 1, 1, 0, base);
	}

	// Walls, with their top-view height in the matrix (the shader raises them for walking), and ceilings.
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const c = idx(x, y);
		if (grid[c] !== WALL) continue;
		const h = 2 + f(-0.25, 0.25);
		const wc = mul(C.wall, f(0.9, 1.08));
		const cc = mul(C.cap, f(0.92, 1.1));
		if (d.cut[c]) {
			const ry = CUT_RY[d.cut[c]];
			S.wallCut.add(wx(x), 0, wz(y), 1, h, 1, ry, wc);
			S.capCut.add(wx(x), h, wz(y), 1, 1, 1, ry, cc);
		} else {
			S.wall.add(wx(x), 0, wz(y), 1, h, 1, 0, wc);
			S.wallCap.add(wx(x), h, wz(y), 1, 1, 1, 0, cc);
		}
	}
	const heights = new Float32Array(W * H);
	const arched = new Set();
	for (const a of d.arches) {
		for (let i = 0; i < a.len; i++) arched.add(Math.round(a.y + (i - (a.len - 1) / 2) * a.py) * W + Math.round(a.x + (i - (a.len - 1) / 2) * a.px));
	}
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const c = idx(x, y);
		if (grid[c] !== FLOOR && grid[c] !== POOL && !d.cut[c]) continue;
		let h = CEILING.corridor;
		if (roomId[c] >= 0) {
			const r = rooms[roomId[c]];
			h = r.type === 'boss' ? CEILING.boss : CEILING[r.arch];
		} else if (d.cut[c] || (grid[c] === POOL && !corridor[c])) {
			// A cut corner or a pocket takes the highest ceiling beside it.
			for (const n of [c - 1, c + 1, c - W, c + W]) if (roomId[n] >= 0) {
				const r = rooms[roomId[n]];
				h = Math.max(h, r.type === 'boss' ? CEILING.boss : CEILING[r.arch]);
			}
		}
		// A doorway's ceiling comes down to its arch, so a door is a door and not a gap under a plank.
		if (arched.has(c)) h = 1.84;
		heights[c] = h;
		S.ceiling.add(wx(x), h, wz(y), 1, CEIL_TOP - h, 1, 0, mul(C.wall, f(0.62, 0.74)));
	}
	// Beams across rooms, at uneven spacing and running the short way.
	for (const r of rooms) {
		if (r.arch === 's' || r.type === 'entrance') continue;
		const h = r.type === 'boss' ? CEILING.boss : CEILING[r.arch];
		const across = r.x1 - r.x0 <= r.y1 - r.y0;
		const a0 = across ? r.y0 : r.x0;
		const a1 = across ? r.y1 : r.x1;
		const b0 = across ? r.x0 : r.y0;
		const b1 = across ? r.x1 : r.y1;
		for (let a = a0 + 2 + f(0, 1); a < a1 - 1; a += f(2.6, 3.8)) {
			const col = mul(mix(C.pillar, hex(0x4a3a2c), 0.7), f(0.7, 0.95));
			// Clipped to where this row of the room really is, so a round room's beam ends in its wall.
			let lo = b1;
			let hi = b0;
			for (let b = b0; b <= b1; b++) {
				const c = across ? idx(b, Math.floor(a)) : idx(Math.floor(a), b);
				if (roomId[c] === r.id) {
					lo = Math.min(lo, b);
					hi = Math.max(hi, b);
				}
			}
			if (hi <= lo) continue;
			const mid = (lo + hi) / 2;
			const len = hi - lo + 2;
			if (across) S.beam.add(wx(mid), h - 0.2, wz(0) + a - 0.5, len, 0.24, 0.3, 0, col);
			else S.beam.add(wx(0) + a - 0.5, h - 0.2, wz(mid), 0.3, 0.24, len, 0, col);
		}
	}
	// A plinth where walls meet floor: a shadow line and something to break the plain wall.
	for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
		const c = idx(x, y);
		if (grid[c] !== WALL || d.cut[c]) continue;
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			if (grid[idx(x + dx, y + dy)] !== FLOOR) continue;
			S.plinth.add(wx(x) + dx * 0.53, 0, wz(y) + dy * 0.53, dx ? 0.14 : 1.002, f(0.2, 0.26), dx ? 1.002 : 0.14, 0, mul(C.wall, f(0.75, 0.92)));
		}
	}

	// Props.
	const shafts = [];
	let portal = null;
	let rune = null;
	for (const p of d.props) {
		const X = wx(p.x);
		const Z = wz(p.y);
		switch (p.kind) {
			case 'pillar': {
				// Its height is the room's ceiling; the shader brings it down to a stub from above.
				const s = p.scale * 1.15;
				const r = rooms[roomId[idx(p.x, p.y)]];
				S.pillar.add(X, 0, Z, s, (r ? CEILING[r.arch] : CEILING.corridor) / 1.79, s, pick4() * (Math.PI / 2), C.pillar);
				break;
			}
			case 'debris':
				S[['debrisA', 'debrisB', 'debrisC'][p.v || 0]].add(X, 0, Z, p.scale, p.scale * 0.85, p.scale, p.rot, mix(hex(TH.debris[0]), hex(TH.debris[1]), raw()));
				break;
			case 'chest':
				S.chest.add(X, 0, Z, 1, 1, 1, p.rot, hex(0x8a5a2c));
				S.chestTrim.add(X, 0, Z, 1, 1, 1, p.rot, hex(0xc8a24a));
				S.chestGlow.add(X, 0, Z, 1, 1, 1, p.rot, hex(0xffd27a));
				break;
			case 'shrineCrystal':
				S.plinthS.add(X, 0, Z, 1, 1, 1, p.rot, mix(C.pillar, [1, 1, 1], 0.12));
				S.crystal.add(X, 1.4, Z, 1.05, 1.05, 1.05, p.rot, hex(0x8fbcff));
				for (let k = 0; k < 4; k++) {
					const a = (k * Math.PI) / 2 + Math.PI / 4;
					const cx = X + Math.cos(a) * 0.36;
					const cz = Z + Math.sin(a) * 0.36;
					S.candle.add(cx, 0.5, cz, 0.8, 0.8, 0.8, 0, hex(0xd8cba8));
					S.flame.add(cx, 0.65, cz, 0.28, 0.28, 0.28, 0, [1, 1, 1]);
				}
				shafts.push([X, Z, 1]);
				break;
			case 'ring':
				S.platform.add(X, -0.02, Z, 1, 1, 1, 0, mix(C.floor, [1, 1, 1], 0.1));
				S.ring.add(X, 0.16, Z, 1, 1, 1, 0, hex(0x3fd0bb));
				S.post.add(X - 1.45, 0.1, Z, 0.72, 0.72, 0.72, 0, C.pillar);
				S.post.add(X + 1.45, 0.1, Z, 0.72, 0.72, 0.72, 0, C.pillar);
				portal = [X, Z];
				shafts.push([X, Z, 0.9]);
				break;
			case 'bossCrystal': {
				S.bossGlow.add(X, 0, Z, 1.15, 1.15, 1.15, p.rot, hex(0xff4636));
				S.bossGlow.add(X + 0.55, 0, Z - 0.42, 0.6, 0.75, 0.6, p.rot + 1.2, hex(0xff6a45));
				S.bossRock.add(X - 0.62, 0, Z + 0.42, 0.75, 0.8, 0.75, p.rot + 2.1, hex(0x4a3336), 0.05, -0.06);
				S.bossRock.add(X + 0.75, 0, Z + 0.55, 0.55, 0.6, 0.55, p.rot + 3.6, hex(0x51383a), -0.06, 0.05);
				S.bossRock.add(X - 0.5, 0, Z - 0.62, 0.5, 0.55, 0.5, p.rot + 4.9, hex(0x452f31), 0.04, 0.04);
				const r = rooms[p.roomId];
				rune = { x: X, z: Z, s: Math.min(1.6, Math.max(0.8, (Math.min(r.w, r.h) / 2 - 1.5) / 2.3)) };
				break;
			}
			case 'brazier':
				S.brazier.add(X, 0, Z, 1, 1, 1, f(0, 6.28), hex(0x3a3f4a));
				S.coals.add(X, 0, Z, 1, 1, 1, 0, hex(0xff7a30));
				S.flame.add(X, 0.6, Z, 1.25, 1.25, 1.25, 0, [1, 1, 1]);
				break;
			case 'grave':
				S.grave.add(X, 0, Z, p.scale, p.scale, p.scale, p.rot, mix(C.wall, [1, 1, 1], 0.15), f(-0.08, 0.08), f(-0.13, 0.13));
				break;
			case 'sarco':
				S.sarco.add(X, 0, Z, 1, 1, 1, p.rot, mix(C.pillar, [1, 1, 1], 0.08));
				break;
			case 'candle':
				S.candle.add(X, 0, Z, p.scale, p.scale, p.scale, 0, hex(0xd8cba8));
				S.flame.add(X, 0.17 * p.scale, Z, 0.3, 0.3, 0.3, 0, [1, 1, 1]);
				break;
			case 'icicle':
				// Hung from the ceiling beside this wall; the shader brings it down to the wall's head from above.
				S.icicle.add(X + p.dx * 0.62, heights[idx(p.x + p.dx, p.y + p.dy)] || 2.25, Z + p.dy * 0.62, p.scale, p.scale, p.scale, p.rot, hex(0xbfe2ff));
				break;
			case 'shardIce':
				S.shardIce.add(X, -0.1, Z, p.scale, p.scale, p.scale, p.rot, hex(0xcfeaff), f(-0.15, 0.15), f(-0.15, 0.15));
				break;
			case 'roots':
				S.roots.add(X, 0, Z, p.scale, p.scale, p.scale, Math.atan2(p.dx, p.dy), hex(0x5a4632));
				break;
			case 'moss':
				S.moss.add(X, 0, Z, p.scale, p.scale, p.scale, p.rot, mix(hex(0x3f6b3a), hex(0x5a8a4a), raw()));
				break;
			case 'crack': {
				const vc = p.ice ? hex(0x9fd8ff) : TH.pools && TH.pools.mode === 3 ? hex(0x86c05a) : hex(0xff6a28);
				S.crackD.add(X - (p.dx || 0) * 0.5, 0, Z - (p.dy || 0) * 0.5, p.scale, p.scale, p.scale, p.rot, vc);
				break;
			}
			case 'bones':
				S.bone.add(X, 0, Z, p.scale, p.scale, p.scale, p.rot, hex(0xcfc4a4));
				break;
			case 'banner': {
				const ry = Math.atan2(p.dx, p.dy);
				const bx = X + p.dx * 0.54;
				const bz = Z + p.dy * 0.54;
				S.bannerRod.add(bx, 1.98, bz, 1, 1, 1, ry, hex(0x6a5a3a));
				S.bannerCloth.add(bx + p.dx * 0.03, 1.96, bz + p.dy * 0.03, 1, 1, 1, ry, C.cloth);
				S.emblem.add(bx + p.dx * 0.06, 1.6, bz + p.dy * 0.06, 1, 1, 1, ry, accent);
				break;
			}
			default:
		}
	}
	for (const t of d.torches) {
		const ry = Math.atan2(t.dx, t.dy);
		const X = wx(t.x) + t.dx * 0.5;
		const Z = wz(t.y) + t.dy * 0.5;
		S.torchArm.add(X, 1.02, Z, 1, 1, 1, ry, hex(0x4a4038));
		S.flame.add(X + t.dx * 0.16, 1.47, Z + t.dy * 0.16, 1, 1, 1, 0, [1, 1, 1]);
	}
	for (const sp of d.spawns) {
		const X = wx(sp.x);
		const Z = wz(sp.y);
		const rot = f(0, 6.28);
		if (sp.tier === 1) {
			S.spawn1.add(X, 0, Z, 1, 1, 1, rot, hex(0x5f4b45));
			S.band2.add(X, 0.14, Z, 0.7, 0.7, 0.7, rot, hex(0xb03a2a));
		} else if (sp.tier === 2) {
			S.spawn2.add(X, 0, Z, 1, 1, 1, rot, hex(0x5a4348));
			S.band2.add(X, 0.55, Z, 1, 1, 1, rot, hex(0xd8433a));
		} else {
			S.spawn3.add(X, 0, Z, 1, 1, 1, rot, hex(0x4c4258));
			S.band3.add(X, 0.62, Z, 1, 1, 1, rot, hex(0x9b6cf0));
			S.markGem.add(X, 1.98, Z, 0.42, 0.42, 0.42, rot, hex(0xb794ff));
		}
	}
	for (const a of d.arches) {
		const X = wx(a.x);
		const Z = wz(a.y);
		const half = a.len / 2 - 0.03;
		const col = mix(C.wall, [1, 1, 1], 0.12);
		if (a.px === 1) {
			S.arch.add(X - half, 0, Z, 1, 1, 1, 0, col);
			S.arch.add(X + half, 0, Z, 1, 1, 1, 0, col);
			S.archL.add(X, 1.62, Z, a.len + 0.42, 1, 1, 0, col);
		} else {
			S.arch.add(X, 0, Z - half, 1, 1, 1, Math.PI / 2, col);
			S.arch.add(X, 0, Z + half, 1, 1, 1, Math.PI / 2, col);
			S.archL.add(X, 1.62, Z, a.len + 0.42, 1, 1, Math.PI / 2, col);
		}
	}
	for (const p of d.pools) {
		S.basin.add(wx(p.x), 0, wz(p.y), 1, 1, 1, 0, mix(C.wall, [0, 0, 0], 0.35));
		const skirtC = TH.pools.mode === 0 ? hex(0xff5a1f) : TH.pools.mode === 3 ? hex(0x33531e) : hex(0x11463c);
		S.skirt.add(wx(p.x), 0, wz(p.y), f(0.85, 1.25), 1, f(0.85, 1.25), f(0, 6.28), skirtC);
	}

	// Liquid surfaces: corner coordinates and which sides are true borders, for the shader's soft edges.
	const liquid = (cells, y) => {
		const key = new Set(cells.map((c) => c.y * W + c.x));
		const n = cells.length;
		const pos = new Float32Array(n * 18);
		const ae = new Float32Array(n * 12);
		const am = new Float32Array(n * 24);
		const CE = [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, -0.5];
		let o = 0;
		let oe = 0;
		let om = 0;
		for (const c of cells) {
			const x0 = wx(c.x) - 0.51;
			const x1 = wx(c.x) + 0.51;
			const z0 = wz(c.y) - 0.51;
			const z1 = wz(c.y) + 0.51;
			pos.set([x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0], o);
			o += 18;
			ae.set(CE, oe);
			oe += 12;
			const m = [key.has(c.y * W + c.x - 1) ? 0 : 1, key.has(c.y * W + c.x + 1) ? 0 : 1, key.has((c.y - 1) * W + c.x) ? 0 : 1, key.has((c.y + 1) * W + c.x) ? 0 : 1];
			for (let k = 0; k < 6; k++) {
				am.set(m, om);
				om += 4;
			}
		}
		return { pos, ae, am };
	};
	const liquids = [];
	if (d.pools.length) liquids.push(liquid(d.pools, -0.08));
	if (d.lakeCells.length) liquids.push(liquid(d.lakeCells, -0.12));

	// Particles rise from what would really make them.
	const spec = TH.particles;
	const pts = [];
	const pp = (x, z, y) => pts.push([x, y, z]);
	if (spec.kind === 1) {
		for (const p of d.pools) pp(wx(p.x) + f(-0.3, 0.3), wz(p.y) + f(-0.3, 0.3), -0.02);
		for (const t of d.torches) pp(wx(t.x) + t.dx * 0.66, wz(t.y) + t.dy * 0.66, 1.5);
		for (const p of d.props) if (p.kind === 'brazier') pp(wx(p.x), wz(p.y), 0.62);
	} else if (spec.kind === 3) {
		for (const p of d.props) {
			if (p.kind === 'grave' || p.kind === 'sarco') pp(wx(p.x) + f(-0.2, 0.2), wz(p.y) + f(-0.2, 0.2), 0.3);
			else if (p.kind === 'candle') pp(wx(p.x), wz(p.y), 0.25);
			else if (p.kind === 'bones') pp(wx(p.x), wz(p.y), 0.1);
		}
		for (const p of d.pools) pp(wx(p.x), wz(p.y), 0);
	} else if (spec.kind === 4) {
		for (const p of d.props) {
			if (p.kind === 'moss') pp(wx(p.x) + f(-0.25, 0.25), wz(p.y) + f(-0.25, 0.25), 0.05);
			else if (p.kind === 'roots') pp(wx(p.x) + p.dx * 0.8, wz(p.y) + p.dy * 0.8, f(0.2, 1.4));
		}
		for (const p of d.pools) pp(wx(p.x), wz(p.y), 0);
	} else if (spec.kind === 0) {
		for (const s of shafts) for (let k = 0; k < 10; k++) pp(s[0] + f(-0.8, 0.8) * s[2], s[1] + f(-0.8, 0.8) * s[2], f(0.3, 2.4));
		for (const t of d.torches) pp(wx(t.x) + t.dx * 0.7, wz(t.y) + t.dy * 0.7, f(1.2, 1.9));
	} else {
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[idx(x, y)] === FLOOR && raw() < 0.25) pp(wx(x), wz(y), 0);
	}
	if (!pts.length) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[idx(x, y)] === FLOOR && raw() < 0.1) pp(wx(x), wz(y), 0);
	const pn = Math.min(spec.n * Math.max(1, d.stats.floorTiles / 3000), Math.max(40, pts.length * 6), 1400) | 0;
	const partPos = new Float32Array(pn * 3);
	const partSeed = new Float32Array(pn);
	for (let i = 0; i < pn; i++) {
		partPos.set(pts[Math.floor(raw() * pts.length)], i * 3);
		partSeed[i] = raw();
	}

	const sets = {};
	for (const n of names) sets[n] = S[n].done();
	return {
		sets,
		heights,
		liquids,
		parts: { pos: partPos, seed: partSeed, kind: spec.kind, color: spec.color },
		portal,
		rune,
		field: opts.noField ? null : bakeField(d, theme),
	};
}

// Everything the level's typed arrays use, so a worker can hand them over without copying.
export function transferList(level) {
	const list = [level.heights.buffer, level.parts.pos.buffer, level.parts.seed.buffer];
	for (const s of Object.values(level.sets)) list.push(s.m.buffer, s.c.buffer);
	for (const l of level.liquids) list.push(l.pos.buffer, l.ae.buffer, l.am.buffer);
	if (level.field) list.push(level.field.color.buffer, level.field.dir.buffer);
	return list;
}
