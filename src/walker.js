// Walking a generated dungeon: a round body against the grid, cut corners and solid props, sliding along what it meets.
// Works on the generator's plain output, so a game can use it without this demo. All in cells.
import { FLOOR, POOL, WALL } from './generator.js';

const RADIUS = 0.25;

export function createWalker(d) {
	const { W, H, grid } = d;
	const cellX = (wx) => wx + W / 2;
	const cellY = (wz) => wz + H / 2;
	// Solid circles, per cell for a quick look-up. Cell coordinates.
	const solids = new Map();
	const addSolid = (x, y, radius) => {
		const r = radius + RADIUS;
		for (let cy = Math.floor(y + 0.5 - r); cy <= Math.floor(y + 0.5 + r); cy++) for (let cx = Math.floor(x + 0.5 - r); cx <= Math.floor(x + 0.5 + r); cx++) {
			const k = cy * W + cx;
			if (!solids.has(k)) solids.set(k, []);
			solids.get(k).push({ x: x + 0.5, y: y + 0.5, r });
		}
	};
	for (const p of d.props) if (p.radius) addSolid(p.x, p.y, p.radius);
	for (const s of d.spawns) addSolid(s.x, s.y, s.radius);
	// The two short posts beside the entrance's portal.
	for (const p of d.props) if (p.kind === 'ring') {
		addSolid(p.x - 1.45, p.y, 0.2);
		addSolid(p.x + 1.45, p.y, 0.2);
	}

	// Door posts stand a little into the opening.
	for (const a of d.arches) {
		const half = a.len / 2 - 0.03;
		addSolid(a.x - a.px * half, a.y - a.py * half, 0.12);
		addSolid(a.x + a.px * half, a.y + a.py * half, 0.12);
	}

	const blocked = (c) => grid[c] === WALL || grid[c] === POOL || grid[c] === 0;
	// Push a point out of a box or of a wall cell's remaining triangle.
	const pushOut = (P, cx, cy, cut) => {
		const x0 = cx;
		const y0 = cy;
		const x1 = cx + 1;
		const y1 = cy + 1;
		if (!cut) {
			const nx = Math.max(x0, Math.min(P.x, x1));
			const ny = Math.max(y0, Math.min(P.y, y1));
			const dx = P.x - nx;
			const dy = P.y - ny;
			const q = dx * dx + dy * dy;
			if (q >= RADIUS * RADIUS) return;
			if (q > 1e-9) {
				const l = Math.sqrt(q);
				P.x = nx + (dx / l) * RADIUS;
				P.y = ny + (dy / l) * RADIUS;
			} else {
				// Inside: out through the nearest side.
				const e = [P.x - x0, x1 - P.x, P.y - y0, y1 - P.y];
				const m = e.indexOf(Math.min(...e));
				if (m === 0) P.x = x0 - RADIUS;
				if (m === 1) P.x = x1 + RADIUS;
				if (m === 2) P.y = y0 - RADIUS;
				if (m === 3) P.y = y1 + RADIUS;
			}
			return;
		}
		// The diagonal runs between the two corners next to the removed one; `cut` 1..4 say which corner is gone.
		const sx = cut === 1 || cut === 2 ? 1 : -1;
		const sy = cut === 1 || cut === 4 ? 1 : -1;
		const mx = cx + 0.5;
		const my = cy + 0.5;
		// Signed distance from the diagonal, positive on the open side.
		const n = Math.SQRT1_2;
		const dist = (P.x - mx) * sx * n + (P.y - my) * sy * n;
		// Corners of the kept triangle.
		const tri = [[mx - sx * 0.5, my - sy * 0.5], [mx + sx * 0.5, my - sy * 0.5], [mx - sx * 0.5, my + sy * 0.5]];
		let bestQ = 1e9;
		let bx = P.x;
		let by = P.y;
		for (let i = 0; i < 3; i++) {
			const a = tri[i];
			const b = tri[(i + 1) % 3];
			const ex = b[0] - a[0];
			const ey = b[1] - a[1];
			const t = Math.max(0, Math.min(1, ((P.x - a[0]) * ex + (P.y - a[1]) * ey) / (ex * ex + ey * ey)));
			const qx = a[0] + ex * t;
			const qy = a[1] + ey * t;
			const q = (P.x - qx) ** 2 + (P.y - qy) ** 2;
			if (q < bestQ) {
				bestQ = q;
				bx = qx;
				by = qy;
			}
		}
		const inside = dist < 0 && Math.abs(P.x - mx) <= 0.5 && Math.abs(P.y - my) <= 0.5;
		if (inside) {
			P.x += sx * n * (-dist + RADIUS);
			P.y += sy * n * (-dist + RADIUS);
			return;
		}
		if (bestQ >= RADIUS * RADIUS) return;
		const l = Math.sqrt(bestQ) || 1;
		P.x = bx + ((P.x - bx) / l) * RADIUS;
		P.y = by + ((P.y - by) / l) * RADIUS;
	};

	const P = { x: 0, y: 0 };
	const collide = () => {
		for (let iter = 0; iter < 3; iter++) {
			const ix = Math.floor(P.x);
			const iy = Math.floor(P.y);
			for (let cy = iy - 1; cy <= iy + 1; cy++) for (let cx = ix - 1; cx <= ix + 1; cx++) {
				if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
				const c = cy * W + cx;
				if (blocked(c)) pushOut(P, cx, cy, d.cut ? d.cut[c] : 0);
			}
			for (const s of solids.get(iy * W + ix) ?? []) {
				const dx = P.x - s.x;
				const dy = P.y - s.y;
				const q = dx * dx + dy * dy;
				if (q < s.r * s.r) {
					const l = Math.sqrt(q) || 1;
					P.x = s.x + (dx / l) * s.r;
					P.y = s.y + (dy / l) * s.r;
				}
			}
		}
	};

	const w = {
		x: 0,
		z: 0,
		yaw: 0,
		pitch: 0,
		vx: 0,
		vz: 0,
		bob: 0,
		speedNow: 0,
		radius: RADIUS,
		// Stand in the entrance, a little off its middle, looking at the way on.
		start() {
			const e = d.rooms[d.entrance];
			const next = d.rooms[d.path[1] ?? d.entrance];
			let door = null;
			let best = 1e9;
			for (let c = 0; c < W * H; c++) {
				if (!d.doorway[c]) continue;
				const x = c % W;
				const y = Math.floor(c / W);
				if (Math.abs(x - e.cx) > e.w / 2 + 2 || Math.abs(y - e.cy) > e.h / 2 + 2) continue;
				const q = Math.hypot(x - next.cx, y - next.cy);
				if (q < best) {
					best = q;
					door = { x, y };
				}
			}
			const to = door ?? { x: next.cx, y: next.cy };
			const a = Math.atan2(to.x - e.cx, to.y - e.cy);
			const spots = [1.6, 2.2, 1, 0.6];
			let sx = e.cx + 0.5;
			let sy = e.cy + 0.5;
			for (const s of spots) {
				const tx = e.cx + 0.5 - Math.sin(a) * s;
				const ty = e.cy + 0.5 - Math.cos(a) * s;
				if (grid[Math.floor(ty) * W + Math.floor(tx)] === FLOOR) {
					sx = tx;
					sy = ty;
					break;
				}
			}
			P.x = sx;
			P.y = sy;
			collide();
			w.x = P.x - W / 2;
			w.z = P.y - H / 2;
			w.yaw = Math.atan2(sx - (to.x + 0.5), sy - (to.y + 0.5));
			w.pitch = 0;
			w.vx = 0;
			w.vz = 0;
			w.bob = 0;
		},
		// move: forward and strafe from -1 to 1. Speeds in cells a second; a cell is 1.5 m, so 2.8 is 4.2 m/s.
		step(dt, forward, strafe, speed) {
			const len = Math.hypot(forward, strafe);
			const f = len > 1 ? forward / len : forward;
			const s = len > 1 ? strafe / len : strafe;
			const sin = Math.sin(w.yaw);
			const cos = Math.cos(w.yaw);
			const tx = (-sin * f + cos * s) * speed;
			const tz = (-cos * f - sin * s) * speed;
			const k = 1 - Math.exp(-dt * (len > 0 ? 12 : 16));
			w.vx += (tx - w.vx) * k;
			w.vz += (tz - w.vz) * k;
			if (Math.abs(w.vx) < 0.002) w.vx = 0;
			if (Math.abs(w.vz) < 0.002) w.vz = 0;
			P.x = cellX(w.x);
			P.y = cellY(w.z);
			// Small steps, so no speed can pass through a thin wall.
			const steps = Math.max(1, Math.ceil((Math.hypot(w.vx, w.vz) * dt) / 0.15));
			for (let i = 0; i < steps; i++) {
				P.x += (w.vx * dt) / steps;
				P.y += (w.vz * dt) / steps;
				collide();
			}
			const nx = P.x - W / 2;
			const nz = P.y - H / 2;
			const moved = Math.hypot(nx - w.x, nz - w.z);
			w.speedNow = dt > 0 ? moved / dt : 0;
			w.x = nx;
			w.z = nz;
			w.bob += moved * 2.1;
		},
		// Where this walker stands on the grid, and the room it's in, or null in a corridor.
		cell() {
			return { x: Math.floor(cellX(w.x)), y: Math.floor(cellY(w.z)) };
		},
		room() {
			const { x, y } = w.cell();
			const id = d.roomId[y * W + x];
			return id >= 0 ? d.rooms[id] : null;
		},
	};
	return w;
}
