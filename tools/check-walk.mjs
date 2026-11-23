// Walks every room of many dungeons with the demo's own walker, in plain Node: node tools/check-walk.mjs [seeds, default 40].
// A bot holds "forward" and steers along a path over the grid. It fails if it stops being able to reach a room, or if it's ever
// found standing inside a wall, a pit or a solid prop. The room graph says connected; this says a body really fits.
import { FLOOR, generateDungeon, THEME_NAMES } from '../src/generator.js';
import { buildLevel } from '../src/level.js';
import { createWalker } from '../src/walker.js';

const SEEDS = Number(process.argv[2] ?? 40);
const fails = [];
let walked = 0;
let reached = 0;
let worstStall = 0;
const t0 = Date.now();
for (const rooms of [8, 24, 60]) for (const loops of [0, 0.3, 0.9]) for (let s = 1; s <= (rooms === 60 ? Math.ceil(SEEDS / 4) : SEEDS); s++) {
	const theme = THEME_NAMES[s % 5];
	const d = generateDungeon({ seed: s * 104729 + rooms, rooms, loops, decor: 1, theme });
	buildLevel(d, { noField: true });
	const w = createWalker(d);
	w.start();
	const { W, H } = d;
	const free = new Uint8Array(W * H);
	for (let i = 0; i < W * H; i++) free[i] = d.grid[i] === FLOOR ? 1 : 0;
	// The bot's path goes from cell middle to cell middle, so a cell is shut if its middle is too near something solid.
	const block = (x, y, r) => {
		const R = Math.ceil(r + 0.5);
		for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
			if (Math.hypot(Math.round(x) + ox - x, Math.round(y) + oy - y) < r + 0.27) free[(Math.round(y) + oy) * W + Math.round(x) + ox] = 0;
		}
	};
	for (const p of d.props) if (p.radius) block(p.x, p.y, p.radius);
	for (const sp of d.spawns) block(sp.x, sp.y, sp.radius);
	for (const p of d.props) if (p.kind === 'ring') {
		block(p.x - 1.45, p.y, 0.2);
		block(p.x + 1.45, p.y, 0.2);
	}
	// Is a point really free? For the "never inside" rule.
	const inside = () => {
		const c = w.cell();
		const i = c.y * W + c.x;
		if (d.grid[i] === FLOOR) return false;
		// A cut wall cell is half open.
		return !d.cut[i];
	};
	const path = (tx, ty) => {
		const st = w.cell();
		const prev = new Int32Array(W * H).fill(-2);
		const q = [st.y * W + st.x];
		prev[q[0]] = -1;
		const goal = ty * W + tx;
		for (let i = 0; i < q.length; i++) {
			const c = q[i];
			if (c === goal) break;
			for (const n of [c - 1, c + 1, c - W, c + W]) if (free[n] && prev[n] === -2) {
				prev[n] = c;
				q.push(n);
			}
		}
		if (prev[goal] === -2) return null;
		const out = [];
		for (let c = goal; c !== -1; c = prev[c]) out.unshift(c);
		return out;
	};
	const label = `rooms ${rooms} loops ${loops} seed ${d.seed} ${theme}`;
	// Room by room, nearest door first in id order: covers doors both ways over a run.
	for (const r of d.rooms) {
		// The free cell nearest its middle that the bot's grid can reach (a gap between gravestones may be shut to the grid alone).
		const cells = [];
		for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (d.roomId[y * W + x] === r.id && free[y * W + x]) cells.push([Math.hypot(x - r.cx, y - r.cy), x, y]);
		cells.sort((p, q) => p[0] - q[0]);
		let route = null;
		for (const [, x, y] of cells.slice(0, 16)) {
			route = path(x, y);
			if (route) break;
		}
		if (!route) {
			fails.push(`${label}: no route to room ${r.id} (${r.type}) from ${JSON.stringify(w.cell())}`);
			continue;
		}
		walked++;
		let i = 1;
		let stall = 0;
		let lx = w.x;
		let lz = w.z;
		for (let frame = 0; frame < 60 * 180 && i < route.length; frame++) {
			const c = route[i];
			const cx = (c % W) + 0.5 - W / 2;
			const cz = Math.floor(c / W) + 0.5 - H / 2;
			if (Math.hypot(cx - w.x, cz - w.z) < 0.35) {
				i++;
				continue;
			}
			w.yaw = Math.atan2(w.x - cx, w.z - cz);
			w.step(1 / 60, 1, 0, 4.4);
			if (inside()) {
				fails.push(`${label}: inside something at ${JSON.stringify(w.cell())}`);
				i = route.length + 1;
			}
			stall = Math.hypot(w.x - lx, w.z - lz) < 0.004 ? stall + 1 : 0;
			worstStall = Math.max(worstStall, stall);
			lx = w.x;
			lz = w.z;
			if (stall > 120) {
				fails.push(`${label}: stuck on the way to room ${r.id} (${r.type}) at ${JSON.stringify(w.cell())}, next ${c % W},${Math.floor(c / W)}`);
				break;
			}
		}
		if (i >= route.length && stall <= 120) reached++;
	}
}
console.log(`walked to ${reached} of ${walked} rooms in ${((Date.now() - t0) / 1000).toFixed(1)} s; longest stall ${worstStall} frames`);
if (fails.length) {
	console.log(`FAILED (${fails.length}):\n${fails.slice(0, 25).join('\n')}`);
	process.exit(1);
}
console.log('passed');
