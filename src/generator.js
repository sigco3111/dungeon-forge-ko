// The dungeon generator: a seed and a few numbers in, a grid and a list of rooms out. No three.js and no DOM, so it runs in
// any game, in a worker or in Node. It's the generator from Dungeon Forge by Majid Manzarpour (MIT), split from its view,
// with these changes, each found by measuring or by walking it (tools/check-generator.mjs):
//   - A theme never changes the floor plan: layout and dressing draw from separate random streams.
//   - Corridors go around rooms they don't belong to, so the room graph is what you walk.
//   - Rooms stand further apart, leaving rock for corridors and a real wall between neighbours.
//   - Roles are given on the links that exist after carving, and rooms of 12 or more get every role the layout can hold.
//   - Solid props say how big they are, and `walkable` is a grid a game can path on.

export const VOID = 0;
export const FLOOR = 1;
export const WALL = 2;
export const POOL = 3;
export const THEME_NAMES = ['ancient', 'molten', 'frost', 'grim', 'verdant'];
export const ROLES = ['entrance', 'combat', 'elite', 'treasure', 'shrine', 'boss'];

// What each theme changes in the dungeon itself. Colours and lights are the view's (themes.js).
export const THEME_RULES = {
	ancient: {
		nameA: ['가라앉은', '잊힌', '고요한', '텅 빈', '오래된', '부서진', '이름 없는', '무너진'],
		nameB: ['회랑', '지하 보고', '카타콤', '심연', '성소', '지하 납골당', '고분', '성유물함'],
	},
	molten: {
		pools: { amount: 0.16, pits: 2 },
		veins: 0.8,
		nameA: ['용융의', '잿빛', '재가 된', '그을린', '검게 탄', '타오르는', '불씨의', '그슬린'],
		nameB: ['대장간', '용광로', '칼데라', '주조소', '가마', '분화구', '도가니', '심연'],
	},
	frost: {
		lakes: true,
		icicles: true,
		nameA: ['얼어붙은', '서리에 묶인', '빙하의', '울부짖는', '창백한', '떨리는', '겨울에 잠긴', '백설에 갇힌'],
		nameB: ['지하 묘실', '동굴', '골짜기', '회랑', '무덤', '굴', '끝자락', '틈새'],
	},
	grim: {
		pools: { amount: 0.05, pits: 1 },
		veins: 0.45,
		graveyards: true,
		bones: true,
		nameA: ['시든', '흐느끼는', '썩어가는', '저주받은', '그늘진', '역병의', '애도하는', '음산한'],
		nameB: ['네크로폴리스', '납골당', '무덤', '시신 안치소', '묘지', '카타콤', '영안실', '지하 묘실'],
	},
	verdant: {
		pools: { amount: 0.05, pits: 1 },
		roots: true,
		nameA: ['푸르른', '우거진', '포자에 얽힌', '뒤엉킨', '이끼 낀', '깨어나는', '야생의', '만개한'],
		nameB: ['정원', '굴', '뿌리', '온실', '골짜기', '숲', '저수조', '정자'],
	},
};

// How wide a solid prop's foot is, in cells (a radius). Anything not listed can be walked through or over.
export const SOLID_RADIUS = { pillar: 0.27, chest: 0.42, sarco: 0.72, grave: 0.2, shrineCrystal: 0.48, bossCrystal: 1.05, brazier: 0.3 };

const SPAWN_RADIUS = [0, 0.14, 0.17, 0.22];

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function makeRng(seed) {
	const r = mulberry32(seed);
	return {
		f: (a, b) => a + r() * (b - a),
		i: (a, b) => a + Math.floor(r() * (b - a + 1)),
		pick: (arr) => arr[Math.floor(r() * arr.length)],
		chance: (p) => r() < p,
		raw: r,
	};
}

// Bowyer-Watson. A room's centre never lands exactly on another's: the tiny offsets keep the triangles well shaped.
function delaunay(pts) {
	const n = pts.length;
	if (n < 2) return [];
	if (n === 2) return [[0, 1]];
	const P = pts.map((p, i) => ({ x: p.x + ((i * 0.618033) % 1) * 1e-3, y: p.y + ((i * 0.414213) % 1) * 1e-3, i }));
	let minX = 1e18;
	let minY = 1e18;
	let maxX = -1e18;
	let maxY = -1e18;
	for (const p of P) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	const dm = Math.max(maxX - minX, maxY - minY, 1);
	const mx = (minX + maxX) / 2;
	const my = (minY + maxY) / 2;
	const mkTri = (a, b, c) => {
		const t = [a, b, c];
		const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
		if (Math.abs(d) < 1e-12) {
			t.ccx = 0;
			t.ccy = 0;
			t.r2 = Infinity;
			return t;
		}
		const a2 = a.x * a.x + a.y * a.y;
		const b2 = b.x * b.x + b.y * b.y;
		const c2 = c.x * c.x + c.y * c.y;
		t.ccx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
		t.ccy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
		t.r2 = (a.x - t.ccx) * (a.x - t.ccx) + (a.y - t.ccy) * (a.y - t.ccy);
		return t;
	};
	let tris = [mkTri({ x: mx - 30 * dm, y: my - dm, i: -1 }, { x: mx, y: my + 30 * dm, i: -2 }, { x: mx + 30 * dm, y: my - dm, i: -3 })];
	for (const p of P) {
		const bad = [];
		const edges = [];
		for (const t of tris) if ((p.x - t.ccx) * (p.x - t.ccx) + (p.y - t.ccy) * (p.y - t.ccy) < t.r2) bad.push(t);
		for (const t of bad) for (let e = 0; e < 3; e++) edges.push([t[e], t[(e + 1) % 3]]);
		const poly = [];
		for (let i = 0; i < edges.length; i++) {
			let shared = false;
			for (let j = 0; j < edges.length; j++) {
				if (i === j) continue;
				const a = edges[i];
				const b = edges[j];
				if ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])) {
					shared = true;
					break;
				}
			}
			if (!shared) poly.push(edges[i]);
		}
		tris = tris.filter((t) => !bad.includes(t));
		for (const e of poly) tris.push(mkTri(e[0], e[1], p));
	}
	tris = tris.filter((t) => t[0].i >= 0 && t[1].i >= 0 && t[2].i >= 0);
	const seen = new Set();
	const out = [];
	for (const t of tris) {
		for (let e = 0; e < 3; e++) {
			const a = t[e].i;
			const b = t[(e + 1) % 3].i;
			const lo = Math.min(a, b);
			const hi = Math.max(a, b);
			const k = lo * 4096 + hi;
			if (!seen.has(k)) {
				seen.add(k);
				out.push([lo, hi]);
			}
		}
	}
	return out;
}

// Depth, difficulty, the critical path and every role, from the links that exist. Run again if carving added any.
function giveRoles(rooms, edges, rng) {
	const N = rooms.length;
	for (const r of rooms) {
		r.type = 'combat';
		r.degree = 0;
	}
	for (const e of edges) {
		e.isCritical = false;
		rooms[e.a].degree++;
		rooms[e.b].degree++;
	}
	const adj = Array.from({ length: N }, () => []);
	edges.forEach((e, i) => {
		adj[e.a].push({ b: e.b, i });
		adj[e.b].push({ b: e.a, i });
	});
	let boss = 0;
	for (let i = 1; i < N; i++) if (rooms[i].w * rooms[i].h > rooms[boss].w * rooms[boss].h) boss = i;
	const distFrom = (src) => {
		const D = new Int32Array(N).fill(-1);
		D[src] = 0;
		const q = [src];
		for (let h = 0; h < q.length; h++) for (const e of adj[q[h]]) if (D[e.b] < 0) {
			D[e.b] = D[q[h]] + 1;
			q.push(e.b);
		}
		return D;
	};
	const dB = distFrom(boss);
	let entrance = -1;
	let bestD = -1;
	for (let i = 0; i < N; i++) if (i !== boss && rooms[i].degree === 1 && dB[i] > bestD) {
		bestD = dB[i];
		entrance = i;
	}
	if (entrance < 0) for (let i = 0; i < N; i++) if (i !== boss && dB[i] > bestD) {
		bestD = dB[i];
		entrance = i;
	}
	const dE = distFrom(entrance);
	let maxDepth = 1;
	for (let i = 0; i < N; i++) if (dE[i] > maxDepth) maxDepth = dE[i];
	rooms.forEach((r, i) => {
		r.depth = Math.max(0, dE[i]);
		r.difficulty = Math.min(1, 0.15 + 0.85 * (r.depth / maxDepth));
	});
	rooms[entrance].type = 'entrance';
	rooms[entrance].difficulty = 0;
	rooms[boss].type = 'boss';
	rooms[boss].difficulty = 1;

	const par = new Int32Array(N).fill(-1);
	const pe = new Int32Array(N).fill(-1);
	const vis = new Uint8Array(N);
	vis[entrance] = 1;
	const q = [entrance];
	for (let h = 0; h < q.length; h++) for (const e of adj[q[h]]) if (!vis[e.b]) {
		vis[e.b] = 1;
		par[e.b] = q[h];
		pe[e.b] = e.i;
		q.push(e.b);
	}
	const crit = new Set();
	const path = [];
	for (let c = boss; c !== -1; c = par[c]) {
		crit.add(c);
		path.unshift(c);
		if (pe[c] >= 0) edges[pe[c]].isCritical = true;
		if (c === entrance) break;
	}
	for (const r of rooms) r.critical = crit.has(r.id);

	const leaves = [];
	for (let i = 0; i < N; i++) if (i !== entrance && i !== boss && rooms[i].degree === 1) leaves.push(i);
	leaves.sort((a, b) => rooms[b].depth - rooms[a].depth);
	for (const i of leaves.slice(0, 4)) rooms[i].type = 'treasure';

	const shrines = [];
	for (let i = 0; i < N; i++) {
		const r = rooms[i];
		if (r.type === 'combat' && !crit.has(i) && r.depth > maxDepth * 0.3 && r.depth < maxDepth * 0.85) shrines.push(i);
	}
	for (let k = 0; k < 2 && shrines.length > 0; k++) rooms[shrines.splice(rng.i(0, shrines.length - 1), 1)[0]].type = 'shrine';
	const elites = [];
	for (const i of crit) {
		const r = rooms[i];
		if (r.type === 'combat' && r.depth >= maxDepth * 0.55 && r.depth <= maxDepth * 0.85) elites.push(i);
	}
	elites.sort((a, b) => rooms[a].depth - rooms[b].depth);
	for (let k = 0; k < Math.min(2, elites.length); k++) rooms[elites[elites.length - 1 - k]].type = 'elite';

	// A dungeon of a dozen rooms or more should have one of each if there's any room to spare.
	if (N >= 12) {
		const has = (t) => rooms.some((r) => r.type === t);
		const combat = (critical) => rooms.filter((r) => r.type === 'combat' && r.critical === critical).sort((a, b) => b.depth - a.depth);
		if (!has('elite')) {
			const c = combat(true);
			if (c.length) c[0].type = 'elite';
		}
		if (!has('treasure')) {
			const c = combat(false);
			if (c.length) c[0].type = 'treasure';
		}
		if (!has('shrine')) {
			const c = combat(false);
			if (c.length) c[Math.floor(c.length / 2)].type = 'shrine';
		}
	}
	return { entrance, boss, maxDepth, path };
}

const key2 = (a, b) => (Math.min(a, b) << 12) | Math.max(a, b);

// The room-to-room links a body could really walk: a run of corridor between rooms, or two rooms touching.
function trueLinks(W, H, grid, roomId, corridor) {
	const links = new Set();
	const seen = new Uint8Array(W * H);
	const stack = [];
	for (let c = 0; c < W * H; c++) {
		if (grid[c] !== FLOOR || !corridor[c] || seen[c]) continue;
		seen[c] = 1;
		stack.push(c);
		const touch = new Set();
		while (stack.length) {
			const v = stack.pop();
			const x = v % W;
			for (const u of [x > 0 ? v - 1 : -1, x < W - 1 ? v + 1 : -1, v - W, v + W]) {
				if (u < 0 || u >= W * H) continue;
				if (roomId[u] >= 0) touch.add(roomId[u]);
				else if (grid[u] === FLOOR && corridor[u] && !seen[u]) {
					seen[u] = 1;
					stack.push(u);
				}
			}
		}
		const t = [...touch];
		for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) links.add(key2(t[i], t[j]));
	}
	for (let c = 0; c < W * H; c++) {
		if (roomId[c] < 0) continue;
		if (c % W < W - 1 && roomId[c + 1] >= 0 && roomId[c + 1] !== roomId[c]) links.add(key2(roomId[c], roomId[c + 1]));
		if (c + W < W * H && roomId[c + W] >= 0 && roomId[c + W] !== roomId[c]) links.add(key2(roomId[c], roomId[c + W]));
	}
	return links;
}

// A corridor's centre line from A to B: straight or one bend when that's clear, or else the cheapest way round. Rooms it
// doesn't belong to cost far more than any detour; they're only crossed if nothing else reaches.
function routeCorridor(A, B, W, H, near, hug, used, rng, heap, budget) {
	const cost = (c) => {
		const owner = near[c];
		if (owner === -2 || (owner >= 0 && owner !== A.id && owner !== B.id)) return 60;
		// Leaving a room straight on costs 8 at each end; running along its wall costs far more.
		return used[c] ? 24 : hug[c] ? 4 : 0;
	};
	const line = (pts) => {
		let score = 0;
		const out = [];
		for (let i = 0; i + 1 < pts.length; i++) {
			const [x0, y0] = pts[i];
			const [x1, y1] = pts[i + 1];
			const dx = Math.sign(x1 - x0);
			const dy = Math.sign(y1 - y0);
			for (let x = x0, y = y0; ; x += dx, y += dy) {
				out.push(y * W + x);
				score += cost(y * W + x);
				if (x === x1 && y === y1) break;
			}
		}
		return { out, score };
	};
	const candidates = [];
	const ovX = Math.min(A.cx + A.w / 2, B.cx + B.w / 2) - Math.max(A.cx - A.w / 2, B.cx - B.w / 2);
	const ovY = Math.min(A.cy + A.h / 2, B.cy + B.h / 2) - Math.max(A.cy - A.h / 2, B.cy - B.h / 2);
	if (ovX >= 5) {
		const x = Math.round((Math.max(A.cx - A.w / 2, B.cx - B.w / 2) + Math.min(A.cx + A.w / 2, B.cx + B.w / 2)) / 2);
		candidates.push(line([[x, A.cy], [x, B.cy]]));
	}
	if (ovY >= 5) {
		const y = Math.round((Math.max(A.cy - A.h / 2, B.cy - B.h / 2) + Math.min(A.cy + A.h / 2, B.cy + B.h / 2)) / 2);
		candidates.push(line([[A.cx, y], [B.cx, y]]));
	}
	const hv = line([[A.cx, A.cy], [B.cx, A.cy], [B.cx, B.cy]]);
	const vh = line([[A.cx, A.cy], [A.cx, B.cy], [B.cx, B.cy]]);
	if (rng.chance(0.5)) candidates.push(hv, vh);
	else candidates.push(vh, hv);
	let best = candidates[0];
	for (const c of candidates) if (c.score < best.score) best = c;
	if (best.score <= 16) return best.out;

	// Search over cell and direction, so a turn can cost something and corridors stay mostly straight.
	const N = W * H * 4;
	if (!heap.g || heap.g.length !== N) {
		heap.g = new Int32Array(N);
		heap.from = new Int32Array(N);
		heap.stamp = new Int32Array(N);
		heap.now = 0;
	}
	heap.now++;
	const { g, from, stamp, now } = heap;
	const DX = [1, -1, 0, 0];
	const DY = [0, 0, 1, -1];
	const goal = B.cy * W + B.cx;
	const open = [];
	const push = (f, s) => {
		open.push([f, s]);
		let i = open.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (open[p][0] <= open[i][0]) break;
			[open[p], open[i]] = [open[i], open[p]];
			i = p;
		}
	};
	const pop = () => {
		const top = open[0];
		const last = open.pop();
		if (open.length) {
			open[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				if (l < open.length && open[l][0] < open[m][0]) m = l;
				if (r < open.length && open[r][0] < open[m][0]) m = r;
				if (m === i) break;
				[open[m], open[i]] = [open[i], open[m]];
				i = m;
			}
		}
		return top;
	};
	const h = (c) => Math.abs((c % W) - B.cx) + Math.abs(Math.floor(c / W) - B.cy);
	const start = A.cy * W + A.cx;
	for (let d = 0; d < 4; d++) {
		const s = start * 4 + d;
		g[s] = 0;
		stamp[s] = now;
		from[s] = -1;
		push(h(start), s);
	}
	let end = -1;
	let spent = 0;
	while (open.length && spent++ < budget) {
		const [, s] = pop();
		const c = s >> 2;
		const d = s & 3;
		if (c === goal) {
			end = s;
			break;
		}
		const x = c % W;
		const y = Math.floor(c / W);
		for (let nd = 0; nd < 4; nd++) {
			const nx = x + DX[nd];
			const ny = y + DY[nd];
			if (nx < 2 || ny < 2 || nx >= W - 2 || ny >= H - 2) continue;
			const nc = ny * W + nx;
			const ns = nc * 4 + nd;
			const ng = g[s] + 1 + cost(nc) + (nd === d ? 0 : 3);
			if (stamp[ns] === now && g[ns] <= ng) continue;
			stamp[ns] = now;
			g[ns] = ng;
			from[ns] = s;
			push(ng + h(nc), ns);
		}
	}
	if (end < 0) return best.out;
	const out = [];
	for (let s = end; s !== -1; s = from[s]) out.push(s >> 2);
	return out;
}

function tryGenerate(seed, params) {
	const rng = makeRng(seed);
	const dress = makeRng((seed ^ 0x5bd1e995) >>> 0);
	const N = params.rooms;
	const TH = THEME_RULES[params.theme];

	// 1. Scatter.
	const R = Math.sqrt(N) * 6;
	const rooms = [];
	const large = [];
	for (let i = 0; i < N; i++) {
		const t = rng.raw();
		let w;
		let h;
		let arch;
		if (t < 0.45) {
			arch = 's';
			w = rng.i(5, 7);
			h = rng.i(5, 7);
		} else if (t < 0.85) {
			arch = 'm';
			w = rng.i(8, 12);
			h = rng.i(8, 12);
		} else {
			arch = 'l';
			w = rng.i(13, 18);
			h = rng.i(13, 18);
			large.push(i);
		}
		const st = rng.raw();
		const shape = st < 0.6 ? 'rect' : st < 0.82 ? 'ellipse' : 'oct';
		const ang = rng.f(0, Math.PI * 2);
		const rad = R * Math.sqrt(rng.raw());
		rooms.push({ id: i, cx: Math.cos(ang) * rad, cy: Math.sin(ang) * rad, w, h, arch, shape, type: 'combat', depth: 0, difficulty: 0.2, degree: 0 });
	}
	while (large.length < 2) {
		const j = rng.i(0, N - 1);
		if (rooms[j].arch !== 'l') {
			rooms[j].arch = 'l';
			rooms[j].w = rng.i(13, 18);
			rooms[j].h = rng.i(13, 18);
			rooms[j].shape = 'rect';
			large.push(j);
		}
	}

	// 2. Separate. An even-sized room is one cell wider than its number and centres round to whole cells, so a gap of 6
	// leaves at least 4 cells of rock: a corridor can pass between two rooms with a wall on each side.
	const PAD = 6;
	{
		const CX = new Float64Array(N);
		const CY = new Float64Array(N);
		const HW = new Float64Array(N);
		const HH = new Float64Array(N);
		for (let i = 0; i < N; i++) {
			CX[i] = rooms[i].cx;
			CY[i] = rooms[i].cy;
			HW[i] = rooms[i].w / 2 + PAD / 2;
			HH[i] = rooms[i].h / 2 + PAD / 2;
		}
		for (let iter = 0; iter < 400; iter++) {
			let moved = false;
			for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
				const ox = HW[i] + HW[j] - Math.abs(CX[i] - CX[j]);
				if (ox <= 0) continue;
				const oy = HH[i] + HH[j] - Math.abs(CY[i] - CY[j]);
				if (oy <= 0) continue;
				moved = true;
				if (ox < oy) {
					const s = CX[i] <= CX[j] ? -1 : 1;
					CX[i] += (s * ox) / 2;
					CX[j] -= (s * ox) / 2;
				} else {
					const s = CY[i] <= CY[j] ? -1 : 1;
					CY[i] += (s * oy) / 2;
					CY[j] -= (s * oy) / 2;
				}
			}
			if (!moved) break;
		}
		for (let i = 0; i < N; i++) {
			rooms[i].cx = Math.round(CX[i]);
			rooms[i].cy = Math.round(CY[i]);
		}
	}

	// 3. Graph: Delaunay, then a minimum spanning tree so everything connects, then some edges back as loops.
	const centers = rooms.map((r) => ({ x: r.cx, y: r.cy }));
	let delEdges = delaunay(centers);
	if (delEdges.length === 0) {
		delEdges = [];
		for (let i = 0; i < N - 1; i++) delEdges.push([i, i + 1]);
	}
	const elen = (e) => Math.hypot(centers[e[0]].x - centers[e[1]].x, centers[e[0]].y - centers[e[1]].y);
	const adj = Array.from({ length: N }, () => []);
	delEdges.forEach((e, idx) => {
		const w = elen(e);
		adj[e[0]].push({ b: e[1], w, idx });
		adj[e[1]].push({ b: e[0], w, idx });
	});
	const inT = new Uint8Array(N);
	inT[0] = 1;
	let inCount = 1;
	const mstIdx = new Set();
	while (inCount < N) {
		let best = null;
		for (let a = 0; a < N; a++) if (inT[a]) for (const e of adj[a]) if (!inT[e.b] && (!best || e.w < best.w)) best = e;
		if (!best) break;
		inT[best.b] = 1;
		inCount++;
		mstIdx.add(best.idx);
	}
	if (inCount < N) return { valid: false, stats: {} };
	let mstLenSum = 0;
	for (const i of mstIdx) mstLenSum += elen(delEdges[i]);
	const mstMean = mstLenSum / Math.max(1, mstIdx.size);
	const edges = [];
	delEdges.forEach((e, idx) => {
		if (mstIdx.has(idx)) edges.push({ a: e[0], b: e[1], isLoop: false, isCritical: false });
		else if (elen(e) < mstMean * 2.2 && rng.chance(params.loops)) edges.push({ a: e[0], b: e[1], isLoop: true, isCritical: false });
	});
	for (const e of edges) {
		rooms[e.a].degree++;
		rooms[e.b].degree++;
	}
	// Dungeons need dead ends: drop loops until there are at least three.
	if (N >= 20) {
		let leafCount = 0;
		for (let i = 0; i < N; i++) if (rooms[i].degree === 1) leafCount++;
		while (leafCount < 3) {
			let bi = -1;
			let bs = -1;
			for (let i = 0; i < edges.length; i++) {
				const e = edges[i];
				if (!e.isLoop) continue;
				const s = (rooms[e.a].degree === 2 ? 1 : 0) + (rooms[e.b].degree === 2 ? 1 : 0);
				const score = s * 10000 + Math.hypot(centers[e.a].x - centers[e.b].x, centers[e.a].y - centers[e.b].y);
				if (score > bs) {
					bs = score;
					bi = i;
				}
			}
			if (bi < 0) break;
			const e = edges[bi];
			if (--rooms[e.a].degree === 1) leafCount++;
			if (--rooms[e.b].degree === 1) leafCount++;
			edges.splice(bi, 1);
		}
	}

	// 4. Paint the rooms on a grid with space around them for corridors that go the long way.
	let minX = 1e9;
	let minY = 1e9;
	let maxX = -1e9;
	let maxY = -1e9;
	for (const r of rooms) {
		minX = Math.min(minX, r.cx - Math.ceil(r.w / 2));
		maxX = Math.max(maxX, r.cx + Math.ceil(r.w / 2));
		minY = Math.min(minY, r.cy - Math.ceil(r.h / 2));
		maxY = Math.max(maxY, r.cy + Math.ceil(r.h / 2));
	}
	const PADG = 7;
	const offX = PADG - minX;
	const offY = PADG - minY;
	const W = maxX - minX + PADG * 2 + 1;
	const H = maxY - minY + PADG * 2 + 1;
	for (const r of rooms) {
		r.cx += offX;
		r.cy += offY;
	}
	const grid = new Uint8Array(W * H);
	const roomId = new Int16Array(W * H).fill(-1);
	const corridor = new Uint8Array(W * H);
	const idx = (x, y) => y * W + x;
	const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
	for (const r of rooms) {
		const rx = r.w / 2;
		const ry = r.h / 2;
		const ch = Math.min(rx, ry) * 0.55;
		let x0 = 1e9;
		let y0 = 1e9;
		let x1 = -1;
		let y1 = -1;
		for (let y = Math.max(0, Math.floor(r.cy - ry)); y <= Math.min(H - 1, Math.ceil(r.cy + ry)); y++) {
			const dy = y - r.cy;
			const ady = Math.abs(dy);
			if (ady > ry) continue;
			for (let x = Math.max(0, Math.floor(r.cx - rx)); x <= Math.min(W - 1, Math.ceil(r.cx + rx)); x++) {
				const dx = x - r.cx;
				const adx = Math.abs(dx);
				if (adx > rx) continue;
				let ok = true;
				if (r.shape === 'ellipse') ok = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
				else if (r.shape === 'oct') ok = adx <= rx - ch || ady <= ry - ch || adx - (rx - ch) + (ady - (ry - ch)) <= ch;
				if (ok) {
					grid[idx(x, y)] = FLOOR;
					roomId[idx(x, y)] = r.id;
					x0 = Math.min(x0, x);
					y0 = Math.min(y0, y);
					x1 = Math.max(x1, x);
					y1 = Math.max(y1, y);
				}
			}
		}
		Object.assign(r, { x0, y0, x1, y1 });
	}

	// 5. Route every corridor. Near-room marks show whose rock a cell is: a room's id, -2 for between two rooms.
	const near = new Int16Array(W * H).fill(-1);
	const CLEAR = 3;
	for (const r of rooms) {
		for (let y = Math.max(0, r.y0 - CLEAR); y <= Math.min(H - 1, r.y1 + CLEAR); y++) {
			for (let x = Math.max(0, r.x0 - CLEAR); x <= Math.min(W - 1, r.x1 + CLEAR); x++) {
				const c = idx(x, y);
				near[c] = near[c] === -1 || near[c] === r.id ? r.id : -2;
			}
		}
	}
	const hug = new Uint8Array(W * H);
	for (const r of rooms) {
		for (let y = Math.max(0, r.y0 - 2); y <= Math.min(H - 1, r.y1 + 2); y++) for (let x = Math.max(0, r.x0 - 2); x <= Math.min(W - 1, r.x1 + 2); x++) if (roomId[idx(x, y)] < 0) hug[idx(x, y)] = 1;
	}
	const used = new Uint8Array(W * H);
	const heap = {};
	const order = edges.map((_, i) => i).sort((a, b) => Number(edges[a].isLoop) - Number(edges[b].isLoop));
	const dropped = new Set();
	for (const i of order) {
		const e = edges[i];
		// A loop gets a short search: one that needs a long way round isn't much of a shortcut anyway.
		e.route = routeCorridor(rooms[e.a], rooms[e.b], W, H, near, hug, used, rng, heap, e.isLoop ? 6000 : 1e9);
		// Crossing corridors join everything they touch, so a boss can end up one walk from the entrance with no room between. The
		// tree has to connect, so its rare crossings stay and are listed; a loop is a bonus, and one that can't stay clear is left out.
		if (e.isLoop && e.route.some((c) => used[c] || (near[c] !== e.a && near[c] !== e.b && near[c] !== -1))) {
			dropped.add(e);
			continue;
		}
		for (const c of e.route) for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
			const u = c + oy * W + ox;
			// Inside a room corridors may share the floor: that joins nothing new.
			if (u >= 0 && u < W * H && roomId[u] < 0) used[u] = 1;
		}
	}

	if (dropped.size) for (let i = edges.length - 1; i >= 0; i--) if (dropped.has(edges[i])) edges.splice(i, 1);

	// 6. Roles decide the widths: the critical path is widest, a way to treasure is sometimes tight. Then carve.
	const rolesRng = makeRng((seed ^ 0x2f6e2b1) >>> 0);
	let graph = giveRoles(rooms, edges, rolesRng);
	const stamp = (x, y) => {
		if (inB(x, y) && grid[idx(x, y)] !== FLOOR) {
			grid[idx(x, y)] = FLOOR;
			corridor[idx(x, y)] = 1;
		}
	};
	for (const e of edges) {
		let w = e.isCritical ? 3 : 2;
		if (!e.isCritical && (rooms[e.a].type === 'treasure' || rooms[e.b].type === 'treasure') && rng.chance(0.4)) w = 1;
		const o = w === 1 ? [0] : w === 2 ? [0, 1] : [-1, 0, 1];
		for (let i = 0; i < e.route.length; i++) {
			const c = e.route[i];
			const n = e.route[i + 1] ?? c;
			const p = e.route[i - 1] ?? c;
			const x = c % W;
			const y = Math.floor(c / W);
			// Both directions at a bend, so its outer corner is as wide as the rest.
			const horiz = Math.abs(n - c) === 1 || Math.abs(c - p) === 1;
			const vert = Math.abs(n - c) === W || Math.abs(c - p) === W;
			for (const k of o) {
				if (horiz) stamp(x, y + k);
				if (vert) stamp(x + k, y);
				if (horiz && vert) for (const j of o) stamp(x + j, y + k);
			}
		}
		e.width = w;
		delete e.route;
	}

	// Whatever carving really connected is the graph. A link nobody planned is a real shortcut, so it's listed and roles
	// follow it.
	const planned = new Set(edges.map((e) => key2(e.a, e.b)));
	let merged = 0;
	for (const k of trueLinks(W, H, grid, roomId, corridor)) {
		if (planned.has(k)) continue;
		edges.push({ a: k >> 12, b: k & 4095, isLoop: true, isCritical: false, width: 2, merged: true });
		merged++;
	}
	if (merged) graph = giveRoles(rooms, edges, rolesRng);
	const { entrance, boss, maxDepth, path } = graph;

	// Walls around everything.
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		if (grid[idx(x, y)] !== FLOOR) continue;
		for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1); ny++) for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
			if (grid[idx(nx, ny)] === VOID) grid[idx(nx, ny)] = WALL;
		}
	}
	const doorway = new Uint8Array(W * H);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const c = idx(x, y);
		if (!corridor[c]) continue;
		if ((x < W - 1 && roomId[c + 1] >= 0) || (x > 0 && roomId[c - 1] >= 0) || (y < H - 1 && roomId[c + W] >= 0) || (y > 0 && roomId[c - W] >= 0)) doorway[c] = 1;
	}

	// Everything from here on is dressing and draws from `dress`, so the plan above is the same in every theme.
	for (const r of rooms) {
		r.lake = false;
		r.grave = false;
	}
	if (TH.lakes) {
		const lc = [];
		for (const r of rooms) if ((r.type === 'combat' || r.type === 'elite') && Math.min(r.w, r.h) >= 9) lc.push(r);
		for (let k = 0; k < 2 && lc.length > 0; k++) lc.splice(dress.i(0, lc.length - 1), 1)[0].lake = true;
	}
	if (TH.graveyards) {
		const gc = [];
		for (const r of rooms) if (r.type === 'combat' && r.shape !== 'ellipse' && Math.min(r.w, r.h) >= 8) gc.push(r);
		for (let k = 0; k < 3 && gc.length > 0; k++) gc.splice(dress.i(0, gc.length - 1), 1)[0].grave = true;
	}

	// Liquid pockets in walls: a wall cell becomes a sunken slot, with any rock it exposes filled in. Floors never change.
	const pools = [];
	if (TH.pools && TH.pools.amount > 0) {
		const nearDoorC = (x, y, d) => {
			for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) {
				const nx = x + ox;
				const ny = y + oy;
				if (inB(nx, ny) && doorway[idx(nx, ny)]) return true;
			}
			return false;
		};
		const cand = [];
		for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
			const c = idx(x, y);
			if (grid[c] !== WALL || nearDoorC(x, y, 2)) continue;
			const nf = (grid[c + 1] === FLOOR ? 1 : 0) + (grid[c - 1] === FLOOR ? 1 : 0) + (grid[c + W] === FLOOR ? 1 : 0) + (grid[c - W] === FLOOR ? 1 : 0);
			if (nf === 1) cand.push({ x, y });
		}
		for (let i = cand.length - 1; i > 0; i--) {
			const j = dress.i(0, i);
			const t = cand[i];
			cand[i] = cand[j];
			cand[j] = t;
		}
		const target = Math.round(cand.length * TH.pools.amount);
		for (const s of cand) {
			if (pools.length >= target) break;
			let close = false;
			for (const p of pools) if (Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) < 3) {
				close = true;
				break;
			}
			if (close) continue;
			grid[idx(s.x, s.y)] = POOL;
			pools.push({ x: s.x, y: s.y });
		}
		for (const p of pools) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
			const nx = p.x + ox;
			const ny = p.y + oy;
			if (inB(nx, ny) && grid[idx(nx, ny)] === VOID) grid[idx(nx, ny)] = WALL;
		}
	}
	// Pits inside rooms: single floor cells sunk into liquid. Interior only and far apart, so a room can never be split.
	if (TH.pools && TH.pools.pits) {
		for (const r of rooms) {
			if ((r.type !== 'combat' && r.type !== 'elite') || r.lake || r.grave) continue;
			let n = Math.min(TH.pools.pits, Math.floor((r.w * r.h) / 45) + 1);
			let guard = 0;
			while (n > 0 && guard++ < 40) {
				const x = dress.i(Math.floor(r.cx - r.w / 2) + 2, Math.ceil(r.cx + r.w / 2) - 2);
				const y = dress.i(Math.floor(r.cy - r.h / 2) + 2, Math.ceil(r.cy + r.h / 2) - 2);
				if (!inB(x, y)) continue;
				const c = idx(x, y);
				if (roomId[c] !== r.id || grid[c] !== FLOOR || doorway[c]) continue;
				let ok = true;
				for (let oy = -1; oy <= 1 && ok; oy++) for (let ox = -1; ox <= 1; ox++) if (grid[idx(x + ox, y + oy)] !== FLOOR) {
					ok = false;
					break;
				}
				if (ok) for (const p of pools) if (Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) < 4) {
					ok = false;
					break;
				}
				if (!ok) continue;
				grid[c] = POOL;
				pools.push({ x, y });
				n--;
			}
		}
	}
	// Frozen lakes stay walkable: the cells are floor, flagged so a view can draw ice.
	const lakeMask = new Uint8Array(W * H);
	const lakeCells = [];
	for (const r of rooms) {
		if (!r.lake) continue;
		for (let y = Math.floor(r.cy - r.h / 2) + 2; y <= Math.ceil(r.cy + r.h / 2) - 2; y++) for (let x = Math.floor(r.cx - r.w / 2) + 2; x <= Math.ceil(r.cx + r.w / 2) - 2; x++) {
			if (!inB(x, y)) continue;
			const c = idx(x, y);
			if (roomId[c] !== r.id || grid[c] !== FLOOR || doorway[c]) continue;
			let solid = false;
			for (let oy = -1; oy <= 1 && !solid; oy++) for (let ox = -1; ox <= 1; ox++) if (grid[idx(x + ox, y + oy)] !== FLOOR) {
				solid = true;
				break;
			}
			if (!solid) {
				lakeMask[c] = 1;
				lakeCells.push({ x, y });
			}
		}
	}
	// Doorway arches: one frame per run of doorway cells across the corridor, up to 3 wide.
	const arches = [];
	{
		const aseen = new Uint8Array(W * H);
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
			const c = idx(x, y);
			if (!doorway[c] || aseen[c]) continue;
			let rx = 0;
			if (x < W - 1 && roomId[c + 1] >= 0) rx = 1;
			else if (x > 0 && roomId[c - 1] >= 0) rx = -1;
			const px = rx === 0 ? 1 : 0;
			const py = rx === 0 ? 0 : 1;
			let x0 = x;
			let y0 = y;
			let x1 = x;
			let y1 = y;
			while (inB(x0 - px, y0 - py) && doorway[idx(x0 - px, y0 - py)] && !aseen[idx(x0 - px, y0 - py)]) {
				x0 -= px;
				y0 -= py;
			}
			while (inB(x1 + px, y1 + py) && doorway[idx(x1 + px, y1 + py)] && !aseen[idx(x1 + px, y1 + py)]) {
				x1 += px;
				y1 += py;
			}
			let len = 0;
			for (let ax = x0, ay = y0; ; ax += px, ay += py) {
				aseen[idx(ax, ay)] = 1;
				len++;
				if (ax === x1 && ay === y1) break;
			}
			// Both posts need a wall to stand in, or the frame would hang in open floor.
			const wallAt = (ax, ay) => inB(ax, ay) && grid[idx(ax, ay)] === WALL;
			if (len <= 3 && wallAt(x0 - px, y0 - py) && wallAt(x1 + px, y1 + py)) arches.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, px, py, len, role: roomId[c + rx] >= 0 ? rooms[roomId[c + rx]].type : null });
		}
	}

	// Connection check, cell by cell from the entrance's middle.
	const bfs = new Int16Array(W * H).fill(-1);
	const ei = idx(rooms[entrance].cx, rooms[entrance].cy);
	let floorTotal = 0;
	for (let i = 0; i < W * H; i++) if (grid[i] === FLOOR) floorTotal++;
	let reach = 0;
	let maxBfs = 0;
	if (grid[ei] === FLOOR) {
		const q = new Int32Array(floorTotal);
		let qh = 0;
		let qt = 0;
		q[qt++] = ei;
		bfs[ei] = 0;
		reach = 1;
		while (qh < qt) {
			const c = q[qh++];
			const x = c % W;
			const b = bfs[c] + 1;
			for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
				if (n >= 0 && n < W * H && grid[n] === FLOOR && bfs[n] < 0) {
					bfs[n] = b;
					q[qt++] = n;
					reach++;
				}
			}
		}
		maxBfs = bfs[q[qt - 1]];
	}
	const valid = reach === floorTotal && floorTotal > 0;

	// Props, spawns and torches: plain data.
	const props = [];
	const spawns = [];
	const occ = new Uint8Array(W * H);
	const nearDoor = (x, y, d) => {
		for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) if (inB(x + ox, y + oy) && doorway[idx(x + ox, y + oy)]) return true;
		return false;
	};
	const interior = (x, y) => {
		for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!inB(x + ox, y + oy) || grid[idx(x + ox, y + oy)] !== FLOOR) return false;
		return true;
	};
	const put = (kind, x, y, rot, scale, rid) => {
		props.push({ kind, x, y, rot: rot || 0, scale: scale || 1, roomId: rid });
		occ[idx(x, y)] = 1;
	};
	for (const r of rooms) {
		const cix = idx(r.cx, r.cy);
		if (r.type === 'entrance') put('ring', r.cx, r.cy, 0, 1, r.id);
		if (r.type === 'boss') {
			put('bossCrystal', r.cx, r.cy, dress.f(0, 6.28), 1, r.id);
			const rr = Math.max(2.5, Math.min(r.w, r.h) / 2 - 2);
			const a0 = dress.f(0, 1);
			for (let k = 0; k < 6; k++) {
				const a = a0 + (k * Math.PI) / 3;
				const bx = Math.round(r.cx + Math.cos(a) * rr);
				const by = Math.round(r.cy + Math.sin(a) * rr);
				if (inB(bx, by) && interior(bx, by) && !occ[idx(bx, by)] && !nearDoor(bx, by, 2)) put('brazier', bx, by, 0, 1, r.id);
			}
		}
		if (r.type === 'treasure' && grid[cix] === FLOOR) put('chest', r.cx, r.cy, (dress.i(0, 3) * Math.PI) / 2, 1, r.id);
		if (r.type === 'shrine' && grid[cix] === FLOOR) put('shrineCrystal', r.cx, r.cy, dress.f(0, 6.28), 1, r.id);
		if ((r.type === 'combat' || r.type === 'elite') && Math.min(r.w, r.h) >= 10 && r.shape !== 'ellipse' && !r.grave && !r.lake) {
			const step = Math.min(r.w, r.h) >= 14 ? 4 : 3;
			for (let y = Math.ceil(r.cy - r.h / 2) + 2; y <= r.cy + r.h / 2 - 2; y++) for (let x = Math.ceil(r.cx - r.w / 2) + 2; x <= r.cx + r.w / 2 - 2; x++) {
				if ((x - r.cx) % step !== 0 || (y - r.cy) % step !== 0) continue;
				if (x === r.cx && y === r.cy) continue;
				if (interior(x, y) && !occ[idx(x, y)] && !nearDoor(x, y, 2)) put('pillar', x, y, 0, dress.f(0.94, 1.06), r.id);
			}
		}
		if (r.grave) {
			for (let y = Math.ceil(r.cy - r.h / 2) + 2; y <= r.cy + r.h / 2 - 2; y += 2) for (let x = Math.ceil(r.cx - r.w / 2) + 2; x <= r.cx + r.w / 2 - 2; x += 2) {
				if (Math.abs(x - r.cx) <= 1 && Math.abs(y - r.cy) <= 1) continue;
				if (interior(x, y) && !occ[idx(x, y)] && !nearDoor(x, y, 2) && dress.chance(0.8)) put('grave', x, y, dress.f(-0.3, 0.3), dress.f(0.85, 1.15), r.id);
			}
			if (Math.min(r.w, r.h) >= 10 && grid[cix] === FLOOR && !occ[cix]) put('sarco', r.cx, r.cy, dress.chance(0.5) ? 0 : Math.PI / 2, 1, r.id);
			let cd = 4;
			while (cd-- > 0) {
				const x = dress.i(Math.floor(r.cx - r.w / 2) + 1, Math.ceil(r.cx + r.w / 2) - 1);
				const y = dress.i(Math.floor(r.cy - r.h / 2) + 1, Math.ceil(r.cy + r.h / 2) - 1);
				if (inB(x, y) && roomId[idx(x, y)] === r.id && grid[idx(x, y)] === FLOOR && !occ[idx(x, y)]) put('candle', x, y, 0, dress.f(0.85, 1.2), r.id);
			}
		}
		if (r.type === 'combat' || r.type === 'elite' || r.type === 'boss') {
			let area = 0;
			for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (roomId[idx(x, y)] === r.id) area++;
			let count = Math.round((area / 18) * (0.5 + r.difficulty));
			if (r.type === 'elite') count = Math.max(2, Math.round(count * 0.6));
			if (r.type === 'boss') count = dress.i(2, 3);
			const tier = r.type === 'elite' ? 3 : Math.max(1, Math.ceil(r.difficulty * 3));
			let guard = 0;
			while (count > 0 && guard++ < 220) {
				const x = dress.i(r.x0 + 1, r.x1 - 1);
				const y = dress.i(r.y0 + 1, r.y1 - 1);
				if (!inB(x, y)) continue;
				const c = idx(x, y);
				// Open floor on every side: a marker in the narrow tip of a round room would shut the way past it.
				if (roomId[c] === r.id && grid[c] === FLOOR && !occ[c] && !lakeMask[c] && interior(x, y) && !nearDoor(x, y, 2)) {
					spawns.push({ x, y, tier, roomId: r.id, radius: SPAWN_RADIUS[tier] });
					occ[c] = 1;
					count--;
				}
			}
		}
	}
	// Torches sit on walls facing floor, not hard against an arch.
	const torchCand = [];
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const c = idx(x, y);
		if (grid[c] !== WALL || nearDoor(x, y, 1)) continue;
		if (x < W - 1 && grid[c + 1] === FLOOR) torchCand.push({ x, y, dx: 1, dy: 0 });
		else if (x > 0 && grid[c - 1] === FLOOR) torchCand.push({ x, y, dx: -1, dy: 0 });
		else if (y < H - 1 && grid[c + W] === FLOOR) torchCand.push({ x, y, dx: 0, dy: 1 });
		else if (y > 0 && grid[c - W] === FLOOR) torchCand.push({ x, y, dx: 0, dy: -1 });
	}
	for (let i = torchCand.length - 1; i > 0; i--) {
		const j = dress.i(0, i);
		const t = torchCand[i];
		torchCand[i] = torchCand[j];
		torchCand[j] = t;
	}
	const torches = [];
	const taken = new Set();
	for (const c of torchCand) {
		let ok = true;
		for (let oy = -4; oy <= 4 && ok; oy++) for (let ox = -4; ox <= 4; ox++) if (taken.has(idx(c.x + ox, c.y + oy))) {
			ok = false;
			break;
		}
		if (ok) {
			torches.push(c);
			taken.add(idx(c.x, c.y));
		}
	}
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const c = idx(x, y);
		if (grid[c] !== FLOOR || occ[c] || doorway[c] || lakeMask[c]) continue;
		const rid = roomId[c];
		const diff = rid >= 0 ? rooms[rid].difficulty : 0.5;
		let p = params.decor * 0.045 * (1.25 - 0.6 * diff);
		if (corridor[c]) p *= 0.45;
		if (dress.chance(p)) props.push({ kind: 'debris', x, y, rot: dress.f(0, 6.28), scale: dress.f(0.6, 1.35), roomId: rid, v: dress.i(0, 2) });
	}
	const floorDir = (x, y) => {
		const c = idx(x, y);
		if (x < W - 1 && grid[c + 1] === FLOOR) return [1, 0];
		if (x > 0 && grid[c - 1] === FLOOR) return [-1, 0];
		if (y < H - 1 && grid[c + W] === FLOOR) return [0, 1];
		if (y > 0 && grid[c - W] === FLOOR) return [0, -1];
		return null;
	};
	if (TH.icicles) {
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
			if (grid[idx(x, y)] !== WALL) continue;
			const d = floorDir(x, y);
			if (d && dress.chance(0.06 + 0.08 * params.decor)) props.push({ kind: 'icicle', x, y, dx: d[0], dy: d[1], rot: dress.f(0, 6.28), scale: dress.f(0.7, 1.3) });
		}
		for (const lc of lakeCells) if (dress.chance(0.05)) props.push({ kind: 'shardIce', x: lc.x, y: lc.y, rot: dress.f(0, 6.28), scale: dress.f(0.6, 1.2) });
	}
	if (TH.roots) {
		const sites = [];
		for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
			if (grid[idx(x, y)] !== WALL) continue;
			const d = floorDir(x, y);
			if (d && roomId[idx(x + d[0], y + d[1])] >= 0) sites.push({ x, y, dx: d[0], dy: d[1] });
		}
		for (let i = sites.length - 1; i > 0; i--) {
			const j = dress.i(0, i);
			const t = sites[i];
			sites[i] = sites[j];
			sites[j] = t;
		}
		const breaches = [];
		for (const s of sites) {
			if (breaches.length >= 5) break;
			let close = false;
			for (const b of breaches) if (Math.max(Math.abs(b.x - s.x), Math.abs(b.y - s.y)) < 7) {
				close = true;
				break;
			}
			if (!close) breaches.push(s);
		}
		const mossMask = new Uint8Array(W * H);
		for (const b of breaches) {
			props.push({ kind: 'roots', x: b.x, y: b.y, dx: b.dx, dy: b.dy, rot: 0, scale: dress.f(0.9, 1.2) });
			for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
				const nx = b.x + ox;
				const ny = b.y + oy;
				if (!inB(nx, ny)) continue;
				const c = idx(nx, ny);
				if (grid[c] === FLOOR && !mossMask[c] && dress.chance(0.75)) {
					mossMask[c] = 1;
					props.push({ kind: 'moss', x: nx, y: ny, rot: dress.f(0, 6.28), scale: dress.f(0.7, 1.4) });
				}
			}
		}
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
			const c = idx(x, y);
			if (grid[c] !== FLOOR || mossMask[c] || lakeMask[c]) continue;
			const nw = (x < W - 1 && grid[c + 1] === WALL ? 1 : 0) + (x > 0 && grid[c - 1] === WALL ? 1 : 0) + (y < H - 1 && grid[c + W] === WALL ? 1 : 0) + (y > 0 && grid[c - W] === WALL ? 1 : 0);
			if (nw > 0 && dress.chance(0.12 * params.decor)) {
				mossMask[c] = 1;
				props.push({ kind: 'moss', x, y, rot: dress.f(0, 6.28), scale: dress.f(0.6, 1.3) });
			}
		}
	}
	if (TH.bones) {
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
			const c = idx(x, y);
			if (grid[c] !== FLOOR || occ[c] || doorway[c] || corridor[c]) continue;
			const rid = roomId[c];
			if (rid >= 0 && rooms[rid].depth > 1 && dress.chance(0.018 + 0.02 * params.decor)) props.push({ kind: 'bones', x, y, rot: dress.f(0, 6.28), scale: dress.f(0.8, 1.2), roomId: rid });
		}
	}
	// Cracks run out of pools and lake shores into the stone, never loose mid-room.
	{
		const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
		if (TH.veins) for (const p of pools) for (const [dx, dy] of DIRS) {
			const nx = p.x + dx;
			const ny = p.y + dy;
			if (inB(nx, ny) && grid[idx(nx, ny)] === FLOOR && dress.chance(TH.veins)) props.push({ kind: 'crack', x: nx, y: ny, dx, dy, rot: dress.f(0, 6.28), scale: dress.f(0.9, 1.5) });
		}
		if (TH.lakes) for (const lc of lakeCells) for (const [dx, dy] of DIRS) {
			const nx = lc.x + dx;
			const ny = lc.y + dy;
			if (!inB(nx, ny)) continue;
			const c2 = idx(nx, ny);
			if (grid[c2] === FLOOR && !lakeMask[c2] && dress.chance(0.3)) props.push({ kind: 'crack', x: nx, y: ny, dx, dy, rot: dress.f(0, 6.28), scale: dress.f(0.7, 1.2), ice: 1 });
		}
	}
	for (const r of rooms) {
		if (r.type !== 'elite' && r.type !== 'boss') continue;
		const cand = [];
		for (let y = r.y0 - 1; y <= r.y1 + 1; y++) for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
			if (!inB(x, y) || grid[idx(x, y)] !== WALL || nearDoor(x, y, 1)) continue;
			const d = floorDir(x, y);
			if (d && roomId[idx(x + d[0], y + d[1])] === r.id) cand.push({ x, y, dx: d[0], dy: d[1] });
		}
		for (let i = cand.length - 1; i > 0; i--) {
			const j = dress.i(0, i);
			const t = cand[i];
			cand[i] = cand[j];
			cand[j] = t;
		}
		const placed = [];
		for (const s of cand) {
			if (placed.length >= (r.type === 'boss' ? 4 : 2)) break;
			let close = false;
			for (const p of placed) if (Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) < 4) {
				close = true;
				break;
			}
			// Not on a torch's stone.
			if (!close && !taken.has(idx(s.x, s.y))) {
				placed.push(s);
				props.push({ kind: 'banner', x: s.x, y: s.y, dx: s.dx, dy: s.dy, rot: 0, scale: 1 });
			}
		}
	}
	for (const p of props) if (SOLID_RADIUS[p.kind]) p.radius = SOLID_RADIUS[p.kind] * (p.scale ?? 1);

	// `walkable`: floor with nothing solid on the cell's middle. A cell a game can path through.
	const walkable = new Uint8Array(W * H);
	for (let i = 0; i < W * H; i++) walkable[i] = grid[i] === FLOOR ? 1 : 0;
	for (const p of props) if (p.radius) walkable[idx(p.x, p.y)] = 0;

	const name = (() => {
		const n = makeRng((seed ^ 0x51ed270b) >>> 0);
		const C = ['Mal', 'Vor', 'Ash', 'Ker', 'Ul', 'Dra', 'Noth', 'Zar', 'Bel', 'Mor', 'Gol', 'Ith'];
		const D = ['goth', 'ath', 'ruk', 'esh', 'mir', 'gul', 'dan', 'oth', 'ek', 'ash', 'uzek', 'arim'];
		const na = n.pick(TH.nameA);
		const nb = n.pick(TH.nameB);
		return `${na} ${nb} (${n.pick(C)}’${n.pick(D)})`;
	})();
	return {
		valid,
		seed,
		params,
		name,
		W,
		H,
		grid,
		roomId,
		corridor,
		doorway,
		walkable,
		bfs,
		maxBfs,
		lakeMask,
		rooms,
		edges,
		entrance,
		boss,
		path,
		maxDepth,
		props,
		spawns,
		torches,
		pools,
		lakeCells,
		arches,
		stats: { rooms: N, edges: edges.length, loops: edges.filter((e) => e.isLoop).length, merged, critLen: path.length - 1, floorTiles: floorTotal, reach, attempts: 1 },
	};
}

// Same input, same output, in every browser and in Node (no Math.random, no clock). Keeps retrying on the rare layout
// that fails its check; `valid` says if none passed, which hasn't happened in testing (tools/check-generator.mjs).
export function generateDungeon({ seed = 1337, rooms = 24, loops = 0.3, decor = 0.6, theme = 'ancient' } = {}) {
	const params = { seed: seed >>> 0, rooms: Math.max(4, Math.round(rooms)), loops, decor, theme };
	if (!THEME_RULES[theme]) throw new Error(`Unknown theme "${theme}". Use one of: ${THEME_NAMES.join(', ')}.`);
	let s = params.seed;
	let d = null;
	let attempt = 0;
	while (attempt < 5) {
		d = tryGenerate(s, params);
		if (d.valid) break;
		s = (Math.imul(s, 9301) + 49297) >>> 0;
		attempt++;
	}
	d.stats.attempts = attempt + 1;
	return d;
}

// The middle of a cell in world units, with the dungeon centred on the origin. Multiply by your cell size (1.5 m is a good
// human scale: corridors of 1.5 to 4.5 m).
export function cellToWorld(d, x, y, cellSize = 1) {
	return { x: (x - d.W / 2 + 0.5) * cellSize, z: (y - d.H / 2 + 0.5) * cellSize };
}

// The cell a world position stands in.
export function worldToCell(d, wx, wz, cellSize = 1) {
	return { x: Math.floor(wx / cellSize + d.W / 2), y: Math.floor(wz / cellSize + d.H / 2) };
}

// The map as text, one character a cell, for reading in a terminal or a chat: # wall, . floor, ~ pool, and each room's role
// letter at its middle (E entrance, C combat, L elite, T treasure, S shrine, B boss).
export function asciiMap(d) {
	const ch = [' ', '.', '#', '~'];
	const letters = { entrance: 'E', combat: 'C', elite: 'L', treasure: 'T', shrine: 'S', boss: 'B' };
	const rows = [];
	for (let y = 0; y < d.H; y++) {
		let row = '';
		for (let x = 0; x < d.W; x++) row += ch[d.grid[y * d.W + x]];
		rows.push(row);
	}
	for (const r of d.rooms) rows[r.cy] = rows[r.cy].slice(0, r.cx) + letters[r.type] + rows[r.cy].slice(r.cx + 1);
	return rows.join('\n');
}
