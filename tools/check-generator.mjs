// The generator's promises, measured in plain Node: node tools/check-generator.mjs [seeds per setting, default 60].
// Same seed same dungeon; the same plan in every theme; every floor cell reached; the room graph is what you can walk;
// a body fits everywhere; every room gets a role. A failure exits with 1.
import { asciiMap, FLOOR, generateDungeon, ROLES, THEME_NAMES } from '../src/generator.js';

const SEEDS = Number(process.argv[2] ?? 60);
const fail = [];
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

// The links that exist on the grid, worked out here from scratch and not with the generator's own code.
function walkedLinks(d) {
	const { W, H, grid, roomId, corridor } = d;
	const links = new Set();
	const seen = new Uint8Array(W * H);
	for (let c = 0; c < W * H; c++) {
		if (grid[c] !== FLOOR || !corridor[c] || seen[c]) continue;
		const q = [c];
		seen[c] = 1;
		const touch = new Set();
		while (q.length) {
			const v = q.pop();
			const x = v % W;
			const y = (v / W) | 0;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
				const u = ny * W + nx;
				if (roomId[u] >= 0) touch.add(roomId[u]);
				else if (grid[u] === FLOOR && corridor[u] && !seen[u]) {
					seen[u] = 1;
					q.push(u);
				}
			}
		}
		const t = [...touch];
		for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) links.add(key(t[i], t[j]));
	}
	for (let c = 0; c < W * H; c++) {
		if (roomId[c] < 0) continue;
		if (c % W < W - 1 && roomId[c + 1] >= 0 && roomId[c + 1] !== roomId[c]) links.add(key(roomId[c], roomId[c + 1]));
		if (c + W < W * H && roomId[c + W] >= 0 && roomId[c + W] !== roomId[c]) links.add(key(roomId[c], roomId[c + W]));
	}
	return links;
}

// Can a body of radius 0.25 cells (0.38 m at 1.5 m a cell) reach every room? Fine grid, 10 samples a cell, with walls and
// solid props grown by the body. Radius 0.25 is what the demo's walker uses.
function bodyReaches(d, radius = 0.25) {
	const K = 10;
	const sw = d.W * K;
	const sh = d.H * K;
	const solid = new Uint8Array(sw * sh);
	const r = Math.round(radius * K);
	for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (d.grid[((y / K) | 0) * d.W + ((x / K) | 0)] !== FLOOR) solid[y * sw + x] = 1;
	const grown = solid.slice();
	for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
		// Only the cells on a wall's edge need growing; this keeps a big dungeon quick.
		if (!solid[y * sw + x]) continue;
		const inner = x > 0 && y > 0 && x < sw - 1 && y < sh - 1 && solid[y * sw + x - 1] && solid[y * sw + x + 1] && solid[(y - 1) * sw + x] && solid[(y + 1) * sw + x];
		if (inner) continue;
		for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
			if (ox * ox + oy * oy > r * r) continue;
			const nx = x + ox;
			const ny = y + oy;
			if (nx >= 0 && ny >= 0 && nx < sw && ny < sh) grown[ny * sw + nx] = 1;
		}
	}
	for (const p of d.props) {
		if (!p.radius) continue;
		const R = p.radius + radius;
		const cx = p.x + 0.5;
		const cy = p.y + 0.5;
		for (let y = Math.floor((cy - R) * K); y < Math.ceil((cy + R) * K); y++) for (let x = Math.floor((cx - R) * K); x < Math.ceil((cx + R) * K); x++) {
			if (x >= 0 && y >= 0 && x < sw && y < sh && Math.hypot((x + 0.5) / K - cx, (y + 0.5) / K - cy) < R) grown[y * sw + x] = 1;
		}
	}
	const e = d.rooms[d.entrance];
	// Stand at the middle of a free cell in the entrance, as the demo does (start() in walker.js).
	let start = -1;
	for (let y = e.y0; y <= e.y1 && start < 0; y++) for (let x = e.x0; x <= e.x1; x++) {
		const i = (y * K + 5) * sw + x * K + 5;
		if (!grown[i]) {
			start = i;
			break;
		}
	}
	if (start < 0) return { cut: d.rooms.length, cells: 0 };
	const vis = new Uint8Array(sw * sh);
	vis[start] = 1;
	const st = [start];
	while (st.length) {
		const v = st.pop();
		const x = v % sw;
		for (const u of [x > 0 ? v - 1 : -1, x < sw - 1 ? v + 1 : -1, v - sw, v + sw]) if (u >= 0 && u < sw * sh && !grown[u] && !vis[u]) {
			vis[u] = 1;
			st.push(u);
		}
	}
	let cut = 0;
	for (const room of d.rooms) {
		let ok = false;
		for (let y = room.y0 * K; y < (room.y1 + 1) * K && !ok; y += 2) for (let x = room.x0 * K; x < (room.x1 + 1) * K; x += 2) if (vis[y * sw + x]) {
			ok = true;
			break;
		}
		if (!ok) cut++;
	}
	return { cut };
}

const rows = [];
for (const rooms of [8, 12, 24, 40, 60]) for (const loops of [0, 0.3, 0.8]) {
	const t = { rooms, loops, invalid: 0, retries: 0, unplanned: 0, merged: 0, cut: 0, plan: 0, repeat: 0, ms: 0, worstMs: 0, W: 0, H: 0, hops: 0, walked: 0, noElite: 0, noTreasure: 0, noShrine: 0, oneHop: 0, loopsKept: 0 };
	for (let s = 1; s <= SEEDS; s++) {
		const theme = THEME_NAMES[s % 5];
		const params = { seed: s * 7919, rooms, loops, decor: 0.6, theme };
		const t0 = performance.now();
		const d = generateDungeon(params);
		const ms = performance.now() - t0;
		t.ms += ms;
		t.worstMs = Math.max(t.worstMs, ms);
		t.W = Math.max(t.W, d.W);
		t.H = Math.max(t.H, d.H);
		if (!d.valid) t.invalid++;
		if (d.stats.attempts > 1) t.retries++;
		// Same input, same bytes.
		const again = generateDungeon(params);
		if (asciiMap(d) !== asciiMap(again) || JSON.stringify(d.props) !== JSON.stringify(again.props)) t.repeat++;
		// Same plan in another theme: corridors and rooms cell for cell.
		const other = generateDungeon({ ...params, theme: THEME_NAMES[(s + 2) % 5] });
		if (!(same(d.corridor, other.corridor) && same(d.roomId, other.roomId) && d.boss === other.boss && d.entrance === other.entrance)) t.plan++;
		// The graph is what you can walk.
		const planned = new Set(d.edges.map((e) => key(e.a, e.b)));
		const walked = walkedLinks(d);
		for (const l of walked) if (!planned.has(l)) t.unplanned++;
		for (const l of planned) if (!walked.has(l)) t.unplanned++;
		t.merged += d.stats.merged;
		// Hops on the walked links against the critical path.
		const adj = d.rooms.map(() => []);
		for (const l of walked) {
			const [a, b] = l.split('-').map(Number);
			adj[a].push(b);
			adj[b].push(a);
		}
		const D = new Int32Array(d.rooms.length).fill(-1);
		D[d.entrance] = 0;
		const q = [d.entrance];
		for (let i = 0; i < q.length; i++) for (const b of adj[q[i]]) if (D[b] < 0) {
			D[b] = D[q[i]] + 1;
			q.push(b);
		}
		t.hops += d.stats.critLen;
		if (d.stats.critLen <= 1 && rooms >= 12) t.oneHop++;
		t.loopsKept += d.stats.loops;
		t.walked += D[d.boss];
		if (D[d.boss] !== d.stats.critLen) fail.push(`rooms ${rooms} loops ${loops} seed ${params.seed}: boss is ${D[d.boss]} rooms away, critical path says ${d.stats.critLen}`);
		for (const role of ['entrance', 'boss']) if (d.rooms.filter((r) => r.type === role).length !== 1) fail.push(`seed ${params.seed}: not one ${role}`);
		for (const r of d.rooms) if (!ROLES.includes(r.type)) fail.push(`seed ${params.seed}: role ${r.type}`);
		if (!d.rooms.some((r) => r.type === 'elite')) t.noElite++;
		if (!d.rooms.some((r) => r.type === 'treasure')) t.noTreasure++;
		if (!d.rooms.some((r) => r.type === 'shrine')) t.noShrine++;
		if (s <= Math.min(SEEDS, rooms >= 40 ? 15 : 60)) {
			const { cut } = bodyReaches(d);
			t.cut += cut;
			if (cut) fail.push(`rooms ${rooms} loops ${loops} seed ${params.seed}: a body can't reach ${cut} room(s)`);
		}
	}
	if (t.invalid) fail.push(`rooms ${rooms} loops ${loops}: ${t.invalid} invalid`);
	if (t.plan) fail.push(`rooms ${rooms} loops ${loops}: the plan changed with the theme in ${t.plan}`);
	if (t.repeat) fail.push(`rooms ${rooms} loops ${loops}: not repeatable in ${t.repeat}`);
	if (t.unplanned) fail.push(`rooms ${rooms} loops ${loops}: ${t.unplanned} links differ from the graph`);
	rows.push({ rooms, loops, invalid: t.invalid, retry: t.retries, planMoved: t.plan, differ: t.repeat, unlisted: t.unplanned, merged: +(t.merged / SEEDS).toFixed(1), cutOff: t.cut, hops: +(t.hops / SEEDS).toFixed(1), walked: +(t.walked / SEEDS).toFixed(1), ms: +(t.ms / SEEDS).toFixed(1), worst: +t.worstMs.toFixed(0), W: t.W, H: t.H, oneHop: t.oneHop, keptLoops: +(t.loopsKept / SEEDS).toFixed(1), noElite: t.noElite, noTreasure: t.noTreasure, noShrine: t.noShrine });
}
console.table(rows);
console.log(asciiMap(generateDungeon({ seed: 1337, rooms: 12 })));
if (fail.length) {
	console.log(`FAILED (${fail.length}):\n${fail.slice(0, 20).join('\n')}`);
	process.exit(1);
}
console.log(`passed: ${rows.length} settings, ${SEEDS} seeds each`);
