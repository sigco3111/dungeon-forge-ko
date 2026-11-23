// Draws a level two ways with one set of materials and programs: a painted miniature from above (Dungeon Forge's look: its
// geometry kit, liquids, particles and post-processing, by Majid Manzarpour, MIT), and a stone interior at eye height. Going
// between them recompiles nothing: the walls rise, the ceiling appears, the lens closes in. Patch's parts: the light field,
// the stone, flames, rising walls and the dolly move.
import * as THREE from 'three';
import { CEIL_TOP } from './level.js';
import { THEMES } from './themes.js';

const LIGHT_K = 4 * Math.PI;
const EYE = 1.07;

function bgFromTris(v) {
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
	const p = g.attributes.position;
	const uv = new Float32Array(p.count * 2);
	for (let i = 0; i < p.count; i++) {
		uv[i * 2] = (p.getX(i) + p.getZ(i)) * 0.53 + 0.5;
		uv[i * 2 + 1] = p.getY(i) * 0.61 + (p.getX(i) - p.getZ(i)) * 0.21;
	}
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	g.computeVertexNormals();
	return g;
}
function chamferBox(w, h, d, ch) {
	const hw = w / 2;
	const hd = d / 2;
	const iw = Math.max(0.01, hw - ch);
	const id = Math.max(0.01, hd - ch);
	const hb = Math.max(0.01, h - ch);
	const v = [];
	const q = (a, b, c, e) => v.push(...a, ...b, ...c, ...a, ...c, ...e);
	const b0 = [-hw, 0, -hd];
	const b1 = [hw, 0, -hd];
	const b2 = [hw, 0, hd];
	const b3 = [-hw, 0, hd];
	const m0 = [-hw, hb, -hd];
	const m1 = [hw, hb, -hd];
	const m2 = [hw, hb, hd];
	const m3 = [-hw, hb, hd];
	const t0 = [-iw, h, -id];
	const t1 = [iw, h, -id];
	const t2 = [iw, h, id];
	const t3 = [-iw, h, id];
	q(b1, b0, m0, m1);
	q(b3, b2, m2, m3);
	q(b2, b1, m1, m2);
	q(b0, b3, m3, m0);
	q(m1, m0, t0, t1);
	q(m3, m2, t2, t3);
	q(m2, m1, t1, t2);
	q(m0, m3, t3, t0);
	q(t3, t2, t1, t0);
	q(b0, b1, b2, b3);
	return bgFromTris(v);
}
// A wall cell with its (+x, +z) corner taken off along the diagonal.
function cutBox(y0, y1, grow = 0) {
	const a = -0.5 - grow;
	const b = 0.5 + grow;
	const v = [];
	const q = (p, r, s, t) => v.push(...p, ...r, ...s, ...p, ...s, ...t);
	const A0 = [a, y0, a];
	const B0 = [b, y0, a];
	const C0 = [a, y0, b];
	const A1 = [a, y1, a];
	const B1 = [b, y1, a];
	const C1 = [a, y1, b];
	q(B0, A0, A1, B1);
	q(A0, C0, C1, A1);
	q(C0, B0, B1, C1);
	v.push(...A1, ...C1, ...B1);
	v.push(...A0, ...B0, ...C0);
	return bgFromTris(v);
}
function spireGeo(rBase, h, twist) {
	const rings = [{ r: rBase, y: 0, a: 0 }, { r: rBase * 0.8, y: h * 0.45, a: twist * 0.5 }, { r: rBase * 0.48, y: h * 0.78, a: twist }];
	const pt = (r, y, a, k) => {
		const ang = a + (k * Math.PI) / 2 + Math.PI / 4;
		return [Math.cos(ang) * r, y, Math.sin(ang) * r];
	};
	const v = [];
	for (let i = 0; i < rings.length - 1; i++) {
		const A = rings[i];
		const B = rings[i + 1];
		for (let k = 0; k < 4; k++) v.push(...pt(A.r, A.y, A.a, k + 1), ...pt(A.r, A.y, A.a, k), ...pt(B.r, B.y, B.a, k), ...pt(A.r, A.y, A.a, k + 1), ...pt(B.r, B.y, B.a, k), ...pt(B.r, B.y, B.a, k + 1));
	}
	const T = rings[rings.length - 1];
	for (let k = 0; k < 4; k++) v.push(...pt(T.r, T.y, T.a, k + 1), ...pt(T.r, T.y, T.a, k), 0, h, 0);
	for (let k = 0; k < 4; k++) v.push(...pt(rings[0].r, 0, 0, k), ...pt(rings[0].r, 0, 0, k + 1), 0, 0, 0);
	return bgFromTris(v);
}
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _E = new THREE.Euler();
function xg(g, x, y, z, rx, ry, rz, sx, sy, sz) {
	const c = g.index ? g.toNonIndexed() : g.clone();
	_m.compose(_p.set(x, y, z), _q.setFromEuler(_E.set(rx, ry, rz)), _s.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
	c.applyMatrix4(_m);
	return c;
}
function mergeGeos(list) {
	let vc = 0;
	for (const g of list) vc += g.attributes.position.count;
	const pos = new Float32Array(vc * 3);
	const nor = new Float32Array(vc * 3);
	const uv = new Float32Array(vc * 2);
	let o = 0;
	for (const g of list) {
		pos.set(g.attributes.position.array, o * 3);
		nor.set(g.attributes.normal.array, o * 3);
		if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
		o += g.attributes.position.count;
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
	out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return out;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const tube = (a, b, c) => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, b, c), 7, 0.055, 6, false);

function makeGeometry() {
	const G = {};
	G.floor = chamferBox(0.985, 0.22, 0.985, 0.045).translate(0, -0.22, 0);
	G.wall = chamferBox(1, 1, 1, 0.07);
	G.wallCut = cutBox(0, 1);
	G.wallCap = chamferBox(1.09, 0.13, 1.09, 0.035);
	G.capCut = cutBox(0, 0.13, 0.02);
	{
		// A ceiling block's bottom and sides, with no top: from above it can't be seen.
		// Exactly one cell wide: blocks that overlapped would flicker where their bottoms share a plane.
		const a = -0.5;
		const b = 0.5;
		const v = [];
		const q = (p, r, s, t) => v.push(...p, ...r, ...s, ...p, ...s, ...t);
		q([a, 0, a], [b, 0, a], [b, 0, b], [a, 0, b]);
		q([b, 0, a], [a, 0, a], [a, 1, a], [b, 1, a]);
		q([a, 0, b], [b, 0, b], [b, 1, b], [a, 1, b]);
		q([b, 0, b], [b, 0, a], [b, 1, a], [b, 1, b]);
		q([a, 0, a], [a, 0, b], [a, 1, b], [a, 1, a]);
		G.ceiling = bgFromTris(v);
	}
	G.beam = chamferBox(1, 1, 1, 0.03);
	G.plinth = chamferBox(1, 1, 1, 0.04);
	G.basin = new THREE.BoxGeometry(1, 0.55, 1).translate(0, -0.43, 0);
	G.pillar = mergeGeos([xg(chamferBox(0.68, 0.15, 0.68, 0.035), 0, 0, 0, 0, 0, 0, 1), xg(new THREE.CylinderGeometry(0.19, 0.25, 1.5, 12), 0, 0.89, 0, 0, 0, 0, 1), xg(new THREE.CylinderGeometry(0.27, 0.27, 0.07, 12), 0, 1.68, 0, 0, 0, 0, 1), xg(chamferBox(0.55, 0.14, 0.55, 0.03), 0, 1.72, 0, 0, 0, 0, 1)]);
	G.archPost = chamferBox(0.26, 1.74, 0.34, 0.045);
	G.archLintel = chamferBox(1, 0.22, 0.36, 0.05);
	G.torch = mergeGeos([xg(new THREE.BoxGeometry(0.07, 0.36, 0.07), 0, 0.16, 0.07, -0.42, 0, 0, 1), xg(new THREE.CylinderGeometry(0.11, 0.05, 0.16, 7), 0, 0.36, 0.15, 0, 0, 0, 1)]);
	G.flame = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
	G.debrisA = xg(new THREE.IcosahedronGeometry(0.15, 0), 0, 0.05, 0, 0, 0, 0, 1);
	G.debrisB = mergeGeos([xg(new THREE.IcosahedronGeometry(0.13, 0), 0, 0.05, 0, 0.3, 0.5, 0, 1), xg(new THREE.IcosahedronGeometry(0.09, 0), 0.17, 0.04, 0.05, 0, 1.1, 0.4, 1), xg(new THREE.IcosahedronGeometry(0.07, 0), -0.12, 0.03, 0.13, 0.7, 0, 0, 1)]);
	G.debrisC = xg(chamferBox(0.34, 0.07, 0.28, 0.02), 0, 0, 0, 0, 0.4, 0.06, 1);
	G.chestBody = mergeGeos([xg(chamferBox(0.8, 0.36, 0.52, 0.04), 0, 0, 0, 0, 0, 0, 1), xg(new THREE.CylinderGeometry(0.25, 0.25, 0.78, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), 0, 0.36, 0, 0, 0, 0, 1), xg(new THREE.CircleGeometry(0.25, 8, 0, Math.PI), 0.39, 0.36, 0, 0, Math.PI / 2, 0, 1), xg(new THREE.CircleGeometry(0.25, 8, 0, Math.PI), -0.39, 0.36, 0, 0, -Math.PI / 2, 0, 1)]);
	G.chestTrim = mergeGeos([xg(new THREE.BoxGeometry(0.07, 0.4, 0.55), -0.2, 0.2, 0, 0, 0, 0, 1), xg(new THREE.BoxGeometry(0.07, 0.4, 0.55), 0.2, 0.2, 0, 0, 0, 0, 1), xg(new THREE.TorusGeometry(0.26, 0.036, 6, 10, Math.PI).rotateY(Math.PI / 2), -0.2, 0.36, 0, 0, 0, 0, 1), xg(new THREE.TorusGeometry(0.26, 0.036, 6, 10, Math.PI).rotateY(Math.PI / 2), 0.2, 0.36, 0, 0, 0, 0, 1), xg(new THREE.BoxGeometry(0.11, 0.16, 0.06), 0, 0.33, 0.26, 0, 0, 0, 1)]);
	G.chestSeam = new THREE.BoxGeometry(0.6, 0.045, 0.03).translate(0, 0.36, 0.25);
	G.grave = mergeGeos([xg(new THREE.BoxGeometry(0.36, 0.5, 0.09), 0, 0.25, 0, 0, 0, 0, 1), xg(new THREE.CylinderGeometry(0.18, 0.18, 0.09, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), 0, 0.5, 0, 0, 0, 0, 1)]);
	G.sarco = mergeGeos([xg(chamferBox(1.5, 0.44, 0.8, 0.06), 0, 0, 0, 0, 0, 0, 1), xg(chamferBox(1.38, 0.16, 0.68, 0.05), 0, 0.44, 0, 0, 0, 0, 1)]);
	G.candle = new THREE.CylinderGeometry(0.05, 0.065, 0.18, 6).translate(0, 0.09, 0);
	G.icicle = mergeGeos([xg(new THREE.ConeGeometry(0.075, 0.5, 6).rotateX(Math.PI), 0, -0.25, 0, 0, 0, 0, 1), xg(new THREE.ConeGeometry(0.05, 0.34, 6).rotateX(Math.PI), 0.11, -0.17, 0.04, 0, 0, 0, 1), xg(new THREE.ConeGeometry(0.04, 0.26, 5).rotateX(Math.PI), -0.09, -0.13, -0.05, 0, 0, 0, 1)]);
	G.shard = spireGeo(0.17, 0.6, 0.6);
	G.roots = mergeGeos([xg(tube(V3(0, 1.75, -0.1), V3(0.05, 1.1, 0.42), V3(0.5, 0.02, 0.75)), 0, 0, 0, 0, 0, 0, 1), xg(tube(V3(-0.1, 1.6, -0.1), V3(-0.3, 0.9, 0.4), V3(-0.55, 0.02, 0.9)), 0, 0, 0, 0, 0, 0, 1), xg(tube(V3(0.12, 1.45, -0.08), V3(0.15, 0.8, 0.3), V3(0.05, 0.02, 1.1)), 0, 0, 0, 0, 0, 0, 1), xg(tube(V3(-0.02, 1.2, -0.05), V3(-0.5, 0.7, 0.3), V3(-0.2, 0.02, 0.55)), 0, 0, 0, 0, 0, 0, 1)]);
	G.moss = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2).translate(0, 0.013, 0);
	G.crack = new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2).translate(0, 0.016, 0);
	G.skirt = new THREE.PlaneGeometry(2.7, 2.7).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
	G.bannerRod = new THREE.CylinderGeometry(0.028, 0.028, 0.74, 6).rotateZ(Math.PI / 2);
	{
		const s = new THREE.Shape();
		s.moveTo(-0.27, 0);
		s.lineTo(0.27, 0);
		s.lineTo(0.27, -0.62);
		s.lineTo(0, -0.8);
		s.lineTo(-0.27, -0.62);
		s.closePath();
		G.bannerCloth = new THREE.ShapeGeometry(s);
	}
	G.emblem = new THREE.PlaneGeometry(0.17, 0.17).rotateZ(Math.PI / 4);
	G.spawn1 = mergeGeos([xg(new THREE.ConeGeometry(0.1, 0.5, 5), 0, 0.24, 0, 0, 0, 0.24, 1), xg(new THREE.ConeGeometry(0.085, 0.42, 5), 0.16, 0.2, -0.06, 0.3, 0, -0.3, 1), xg(new THREE.ConeGeometry(0.07, 0.34, 5), -0.13, 0.17, 0.11, -0.28, 0, 0.22, 1)]);
	G.spawn2 = spireGeo(0.17, 1.15, 0.5);
	G.band2 = chamferBox(0.26, 0.07, 0.26, 0.015);
	G.spawn3 = spireGeo(0.22, 1.65, 0.85);
	G.band3 = chamferBox(0.33, 0.09, 0.33, 0.02);
	G.bossShard = spireGeo(0.34, 2.3, 0.7);
	G.plinthS = chamferBox(0.92, 0.5, 0.92, 0.06);
	G.platform = chamferBox(2.35, 0.14, 2.35, 0.06);
	G.crystal = mergeGeos([xg(new THREE.OctahedronGeometry(0.3, 0), 0, 0, 0, 0, 0, 0, 1, 1.45, 1), xg(new THREE.OctahedronGeometry(0.16, 0), 0, 0.34, 0, 0, 0.6, 0, 1, 1.4, 1)]);
	G.ring = new THREE.TorusGeometry(0.95, 0.07, 8, 30).rotateX(-Math.PI / 2);
	G.portal = new THREE.CircleGeometry(0.86, 24).rotateX(-Math.PI / 2);
	G.runeRing = new THREE.RingGeometry(1.5, 2.3, 48).rotateX(-Math.PI / 2);
	G.shaft = new THREE.CylinderGeometry(0.45, 1.7, 6, 12, 1, true).translate(0, 3, 0);
	G.brazier = mergeGeos([xg(new THREE.BoxGeometry(0.07, 0.5, 0.07), 0.16, 0.25, 0, 0, 0, -0.25, 1), xg(new THREE.BoxGeometry(0.07, 0.5, 0.07), -0.08, 0.25, 0.14, 0.22, 0, 0.13, 1), xg(new THREE.BoxGeometry(0.07, 0.5, 0.07), -0.08, 0.25, -0.14, -0.22, 0, 0.13, 1), xg(new THREE.CylinderGeometry(0.32, 0.16, 0.26, 9), 0, 0.52, 0, 0, 0, 0, 1)]);
	G.coals = mergeGeos([xg(new THREE.IcosahedronGeometry(0.09, 0), 0, 0.63, 0.03, 0, 0, 0, 1), xg(new THREE.IcosahedronGeometry(0.07, 0), 0.1, 0.62, -0.06, 0, 0.5, 0, 1), xg(new THREE.IcosahedronGeometry(0.06, 0), -0.1, 0.61, -0.02, 0.4, 0, 0, 1)]);
	G.bone = mergeGeos([xg(new THREE.CylinderGeometry(0.024, 0.024, 0.34, 5).rotateZ(Math.PI / 2), 0, 0.03, 0, 0, 0.4, 0, 1), xg(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5).rotateZ(Math.PI / 2), 0.04, 0.05, 0.06, 0, -0.7, 0, 1), xg(new THREE.SphereGeometry(0.08, 7, 6), -0.12, 0.08, -0.09, 0, 0, 0, 1), xg(new THREE.BoxGeometry(0.07, 0.05, 0.06), -0.12, 0.03, -0.03, 0, 0, 0, 1)]);
	return G;
}

function canvasTex(size, draw) {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	draw(c.getContext('2d'));
	return new THREE.CanvasTexture(c);
}
// Procedural decals, from Dungeon Forge. They come out the same on every load.
function mulberry(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function makeDecals() {
	const r = mulberry(0xc0ffee);
	const crack = canvasTex(128, (g) => {
		g.lineCap = 'round';
		const branch = (x, y, a, w, d) => {
			if (d <= 0 || w < 0.4) return;
			const len = 9 + r() * 15;
			const nx = x + Math.cos(a) * len;
			const ny = y + Math.sin(a) * len;
			g.strokeStyle = `rgba(255,255,255,${(0.45 + 0.5 * Math.min(1, w / 3)).toFixed(2)})`;
			g.lineWidth = w;
			g.beginPath();
			g.moveTo(x, y);
			g.lineTo(nx, ny);
			g.stroke();
			branch(nx, ny, a + (r() - 0.5), w * 0.76, d - 1);
			if (r() < 0.55) branch(nx, ny, a + (r() - 0.5) * 2.2, w * 0.55, d - 2);
		};
		for (let i = 0; i < 3; i++) branch(64, 64, r() * 6.28, 3, 6);
	});
	const rune = canvasTex(256, (g) => {
		g.translate(128, 128);
		g.lineCap = 'round';
		g.strokeStyle = 'rgba(255,255,255,0.85)';
		g.lineWidth = 3;
		g.beginPath();
		g.arc(0, 0, 104, 0, 6.2832);
		g.stroke();
		g.lineWidth = 1.6;
		g.beginPath();
		g.arc(0, 0, 76, 0, 6.2832);
		g.stroke();
		for (let i = 0; i < 20; i++) {
			g.save();
			g.rotate((i / 20) * 6.2832);
			g.translate(90, 0);
			g.rotate(1.5708);
			g.lineWidth = 2.6;
			g.beginPath();
			let x = -4 + r() * 8;
			let y = -7;
			g.moveTo(x, y);
			for (let s = 0; s < 3; s++) {
				x += (r() - 0.5) * 12;
				y += 4 + r() * 4;
				g.lineTo(x, y);
			}
			g.stroke();
			g.restore();
		}
	});
	const swirl = canvasTex(256, (g) => {
		g.translate(128, 128);
		for (let a = 0; a < 3; a++) {
			g.rotate((Math.PI * 2) / 3);
			g.strokeStyle = 'rgba(255,255,255,0.6)';
			g.lineWidth = 7;
			g.lineCap = 'round';
			g.beginPath();
			for (let t = 0; t < 1; t += 0.02) {
				const rad = 18 + t * 96;
				const an = t * 5.2;
				if (t === 0) g.moveTo(Math.cos(an) * rad, Math.sin(an) * rad);
				else g.lineTo(Math.cos(an) * rad, Math.sin(an) * rad);
			}
			g.stroke();
		}
	});
	const shaft = canvasTex(64, (g) => {
		const grd = g.createLinearGradient(0, 0, 0, 64);
		grd.addColorStop(0, 'rgba(255,255,255,1)');
		grd.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = grd;
		g.fillRect(0, 0, 64, 64);
	});
	const glow = canvasTex(128, (g) => {
		const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
		grd.addColorStop(0, 'rgba(255,255,255,0.9)');
		grd.addColorStop(0.5, 'rgba(255,255,255,0.3)');
		grd.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = grd;
		g.fillRect(0, 0, 128, 128);
	});
	// Moss: an uneven blot, never a disc.
	const moss = canvasTex(128, (g) => {
		for (let i = 0; i < 90; i++) {
			const a = r() * 6.283;
			const d = r() ** 0.7 * 44;
			const s = 3 + r() * 11;
			const grd = g.createRadialGradient(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, s);
			grd.addColorStop(0, 'rgba(255,255,255,0.6)');
			grd.addColorStop(1, 'rgba(255,255,255,0)');
			g.fillStyle = grd;
			g.fillRect(0, 0, 128, 128);
		}
	});
	return { crack, rune, swirl, shaft, glow, moss };
}

const LIQUID_FRAG = `
	precision highp float;
	varying vec2 vP, vE;
	varying vec4 vM;
	uniform float uTime, uMode, uGlow, uOp;
	uniform vec3 uColA, uColB;
	float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
	float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
		float a=h21(i), b=h21(i+vec2(1,0)), c=h21(i+vec2(0,1)), d=h21(i+vec2(1,1));
		return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
	float fbm(vec2 p){ float v=0.0, a=0.5;
		for(int i=0;i<4;i++){ v+=a*vnoise(p); p=p*2.03+11.7; a*=0.5; } return v; }
	void main(){
		vec3 col;
		if(uMode < 0.5){
			float n = fbm(vP*0.55 + vec2(uTime*0.045, uTime*0.021));
			float crust = smoothstep(0.40, 0.62, n);
			float veins = smoothstep(0.06, 0.0, abs(n-0.5));
			col = mix(uColB*1.6, uColA, crust);
			col += vec3(1.0,0.72,0.32) * veins * 0.9;
			col += uColB * 0.22 * (0.5 + 0.5*sin(uTime*1.7 + n*22.0));
		} else if(uMode < 1.5){
			float n = fbm(vP*0.8);
			float cr = smoothstep(0.47, 0.5, abs(fract(n*6.0)-0.5));
			col = mix(uColA, uColB, n);
			col += vec3(1.0) * cr * 0.16;
			float tw = step(0.994, h21(floor(vP*3.0) + floor(uTime*2.0)));
			col += vec3(0.8,0.95,1.0) * tw * 0.45;
		} else if(uMode < 2.5){
			float n = fbm(vP*0.7 + vec2(uTime*0.05, -uTime*0.035));
			float n2 = fbm(vP*1.3 - vec2(uTime*0.04, uTime*0.05));
			float caust = pow(1.0 - abs(n - n2), 6.0);
			col = mix(uColA, uColB, n*0.85) + vec3(0.5,0.9,0.8)*caust*0.35;
		} else {
			vec2 w = vP + 1.5*vec2(fbm(vP*0.35 + uTime*0.02), fbm(vP*0.35 - uTime*0.016));
			float n = fbm(w*0.5);
			col = mix(uColA, uColB, smoothstep(0.25, 0.75, n));
			col += uColB * 0.3 * smoothstep(0.6, 0.9, n);
		}
		float e = 0.0;
		e = max(e, vM.x * smoothstep(0.26, 0.5, -vE.x));
		e = max(e, vM.y * smoothstep(0.26, 0.5,  vE.x));
		e = max(e, vM.z * smoothstep(0.26, 0.5, -vE.y));
		e = max(e, vM.w * smoothstep(0.26, 0.5,  vE.y));
		float aOut = uOp;
		if(uMode < 0.5)      col = mix(col, vec3(0.10,0.03,0.01), e*0.85);
		else if(uMode < 1.5) col *= (1.0 - 0.25*e);
		else if(uMode < 2.5) col *= (1.0 - 0.4*e);
		else                 aOut *= (1.0 - 0.55*e);
		gl_FragColor = vec4(col * (0.5 + uGlow), aOut);
	}`;

const PART_VERT = `
	attribute float aSeed;
	uniform float uTime, uPx, uKind;
	varying float vA;
	float h(float n){ return fract(sin(n*127.1)*43758.5453); }
	void main(){
		vec3 p = position;
		float s = aSeed, t, w;
		if(uKind < 0.5){
			w = 0.05 + 0.05*h(s+3.1);
			p.x += sin(uTime*0.10 + s*17.0)*0.25;
			p.z += cos(uTime*0.08 + s*23.0)*0.25;
			p.y += 0.25*sin(uTime*0.13 + s*31.0);
			vA = 0.10 + 0.08*sin(uTime*0.5 + s*40.0);
		} else if(uKind < 1.5){
			w = 0.045 + 0.05*h(s+3.1);
			t = fract(uTime*(0.10 + 0.08*h(s)) + s);
			p.y += t*(1.1 + 0.9*h(s+5.0));
			p.x += sin(t*9.0 + s*50.0)*0.10;
			p.z += cos(t*8.0 + s*60.0)*0.10;
			vA = smoothstep(0.0,0.05,t)*(1.0-t)*(0.55 + 0.45*sin(uTime*10.0 + s*90.0));
		} else if(uKind < 2.5){
			w = 0.04 + 0.045*h(s+3.1);
			t = fract(uTime*(0.035 + 0.02*h(s)) + s);
			p.y += (1.0-t)*2.1;
			p.x += sin(uTime*0.5 + s*30.0)*0.3;
			p.z += cos(uTime*0.42 + s*36.0)*0.3;
			vA = 0.5*smoothstep(0.0,0.05,t)*smoothstep(1.0,0.95,t);
		} else if(uKind < 3.5){
			w = 0.09 + 0.07*h(s+3.1);
			p.x += sin(uTime*0.25 + s*44.0)*0.35;
			p.z += cos(uTime*0.21 + s*52.0)*0.35;
			p.y += 0.35 + 0.25*sin(uTime*0.4 + s*20.0);
			vA = 0.16 + 0.14*sin(uTime*1.3 + s*70.0);
		} else {
			w = 0.035 + 0.04*h(s+3.1);
			t = fract(uTime*0.03*(0.6 + h(s)) + s);
			p.y += t*1.3 + 0.08;
			p.x += sin(uTime*0.35 + s*25.0)*0.3;
			p.z += cos(uTime*0.3 + s*29.0)*0.3;
			vA = 0.35*smoothstep(0.0,0.08,t)*(1.0-t);
		}
		vec4 mv = modelViewMatrix * vec4(p, 1.0);
		gl_Position = projectionMatrix * mv;
		gl_PointSize = max(w * uPx / max(0.05, -mv.z), 1.2);
	}`;

export function createView(canvas, options = {}) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
	renderer.debug.checkShaderErrors = false;
	let pixelCap = options.pixelCap ?? 1.5;
	renderer.setPixelRatio(Math.min(devicePixelRatio, pixelCap));
	renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	renderer.shadowMap.autoUpdate = false;
	renderer.info.autoReset = false;

	const scene = new THREE.Scene();
	scene.fog = new THREE.FogExp2(0x07080d, 0.002);
	const camera = new THREE.PerspectiveCamera(10, 1, 1, 3000);
	camera.rotation.order = 'YXZ';

	const hemi = new THREE.HemisphereLight(0x2e3a52, 0x0a0b10, 0.55);
	scene.add(hemi);
	const dirL = new THREE.DirectionalLight(0xffe8c8, 0.85);
	dirL.position.set(72, 78, 46);
	dirL.castShadow = true;
	dirL.shadow.mapSize.set(2048, 2048);
	dirL.shadow.bias = -0.0004;
	dirL.shadow.normalBias = 0.55;
	dirL.shadow.camera.near = 1;
	dirL.shadow.camera.far = 320;
	scene.add(dirL);
	scene.add(dirL.target);
	// The one real lamp: a soft light you carry, so the stone's relief shows close up.
	const carried = new THREE.PointLight(0xffb070, 0, 7, 2);
	scene.add(carried);

	const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
	blank.needsUpdate = true;
	const U = {
		uField: { value: blank },
		uFieldDir: { value: blank },
		uFieldMap: { value: new THREE.Vector4(0, 0, 0, 0) },
		uFieldGain: { value: 1 },
		uTime: { value: 0 },
		uRaise: { value: 0 },
		uTop: { value: CEIL_TOP },
		uRevealT: { value: 1e6 },
		uRevealC: { value: new THREE.Vector2() },
		tWall: { value: blank },
		tWallN: { value: blank },
		tStone: { value: blank },
		tStoneN: { value: blank },
	};

	// Everything lit shares this patch: reveal, rising walls, the world-mapped stone and the light field.
	const patch = (mat, { stone = null, shape = null, reveal = 'pop', lit = true, scale = 0.5 } = {}) => {
		const defs = [];
		if (stone) defs.push(`#define STONE ${stone === 'wall' ? 1 : 0}`);
		const key = `${stone}|${shape}|${reveal}|${lit}|${scale}`;
		mat.customProgramCacheKey = () => key;
		mat.onBeforeCompile = (s) => {
			Object.assign(s.uniforms, U);
			s.vertexShader = `${defs.join('\n')}
				varying vec3 vWP; varying vec3 vWN;
				uniform float uRaise, uTop, uRevealT; uniform vec2 uRevealC;
				${s.vertexShader}`
				.replace('#include <begin_vertex>', `#include <begin_vertex>
				#ifdef USE_INSTANCING
				{
					float syI = length(instanceMatrix[1].xyz);
					${shape === 'wall' ? 'transformed.y *= mix(1.0, uTop / syI, uRaise);' : ''}
					${shape === 'cap' ? 'transformed.y += (uTop - instanceMatrix[3].y) * uRaise / syI;' : ''}
					${shape === 'pillar' ? 'transformed.y *= mix(1.15 / syI, 1.0, uRaise);' : ''}
					${shape === 'tag' ? 'transformed *= max(1.0 - uRaise * 1.6, 0.0001);' : ''}
					${shape === 'hang' ? 'transformed.y += (1.75 - instanceMatrix[3].y) * (1.0 - uRaise) / syI;' : ''}
					float rk = clamp((uRevealT - length(instanceMatrix[3].xz - uRevealC) * 0.012) / 0.42, 0.0, 1.0);
					if (rk < 1.0) {
						float rg = 1.0 + 2.70158 * pow(rk - 1.0, 3.0) + 1.70158 * pow(rk - 1.0, 2.0);
						rg = max(rg * min(1.0, rk * 8.0), 0.0001);
						${reveal === 'rise' ? 'transformed.y *= rg;' : 'transformed *= rg;'}
					}
				}
				#endif`)
				.replace('#include <project_vertex>', `#include <project_vertex>
				{
					mat4 mw = modelMatrix;
					#ifdef USE_INSTANCING
					mw = mw * instanceMatrix;
					#endif
					vWP = (mw * vec4(transformed, 1.0)).xyz;
					${lit ? 'vWN = normalize((mw * vec4(objectNormal, 0.0)).xyz);' : ''}
				}`);
			let fs = `${defs.join('\n')}
				varying vec3 vWP; varying vec3 vWN;
				uniform sampler2D uField, uFieldDir, tWall, tWallN, tStone, tStoneN;
				uniform vec4 uFieldMap; uniform float uFieldGain, uTime;
				${s.fragmentShader}`;
			if (stone) {
				fs = fs
					.replace('#include <map_fragment>', `
					vec3 wn0 = normalize(vWN);
					vec2 suv; vec3 sT; vec3 sB;
					if (abs(wn0.y) > 0.7) { suv = vWP.xz; sT = vec3(1.0, 0.0, 0.0); sB = vec3(0.0, 0.0, 1.0); }
					else {
						vec2 t2 = normalize(vec2(-wn0.z, wn0.x));
						suv = vec2(dot(vWP.xz, t2), vWP.y);
						sT = vec3(t2.x, 0.0, t2.y); sB = vec3(0.0, 1.0, 0.0);
					}
					#if STONE == 1
					vec4 sA = texture2D(tWall, suv * ${wallScale().toFixed(3)});
					vec3 sN = texture2D(tWallN, suv * ${wallScale().toFixed(3)}).xyz * 2.0 - 1.0;
					#else
					vec4 sA = texture2D(tStone, suv * ${scale.toFixed(3)});
					vec3 sN = texture2D(tStoneN, suv * ${scale.toFixed(3)}).xyz * 2.0 - 1.0;
					#endif
					diffuseColor.rgb *= sA.rgb;`)
					.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
					roughnessFactor = clamp(roughnessFactor * sA.a * 1.1, 0.05, 1.0);`)
					.replace('#include <normal_fragment_maps>', `
					normal = normalize((viewMatrix * vec4(normalize(sT * sN.x + sB * sN.y + wn0 * sN.z), 0.0)).xyz);`);
			}
			if (lit) {
				fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
				{
					vec3 wNf = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
					vec2 fuv = (vWP.xz + wNf.xz * 0.42) * uFieldMap.xy + uFieldMap.zw;
					vec4 fc = texture2D(uField, fuv);
					vec4 fd = texture2D(uFieldDir, fuv);
					vec3 fcol = fc.rgb * fc.rgb * 4.0;
					float drop = 1.5 - vWP.y;
					vec3 Lw = normalize(vec3(fd.x * 2.0 - 1.0, drop * 0.55, fd.y * 2.0 - 1.0) + vec3(0.0, 0.0001, 0.0));
					float wrap = mix(0.75, 0.15, fd.z);
					float nl = clamp((dot(wNf, Lw) + wrap) / (1.0 + wrap), 0.0, 1.0);
					float fall = 1.0 / (1.0 + drop * drop * 0.16);
					float flick = 0.94 + 0.08 * sin(uTime * 7.3 + vWP.x * 0.7 + vWP.z * 0.9) * sin(uTime * 4.1 + vWP.z * 0.5 - vWP.x * 0.3);
					vec3 fE = fcol * fall * flick * uFieldGain;
					vec3 fdiff = diffuseColor.rgb * (1.0 - metalnessFactor);
					reflectedLight.directDiffuse += fE * mix(nl, 1.0, 0.3) * fdiff * 1.2;
					vec3 Lv = normalize((viewMatrix * vec4(Lw, 0.0)).xyz);
					vec3 Hv = normalize(Lv + normalize(vViewPosition));
					float sp = pow(clamp(dot(normal, Hv), 0.0, 1.0), mix(90.0, 8.0, roughnessFactor)) * (1.0 - roughnessFactor * 0.82);
					reflectedLight.directSpecular += fE * nl * sp * mix(vec3(0.28), diffuseColor.rgb, metalnessFactor) * 1.4;
					float high = clamp(vWP.y / 1.6, 0.0, 1.0);
					float aoAmt = wNf.y < -0.4 ? 0.0 : high;
					float ao = mix(fc.a, 1.0, aoAmt);
					reflectedLight.directDiffuse *= ao;
					reflectedLight.indirectDiffuse *= ao * ao;
					reflectedLight.directSpecular *= ao;
				}`);
			}
			s.fragmentShader = fs;
		};
		return mat;
	};
	function wallScale() {
		// One tile of ashlar covers 2 cells across and up. Eight courses to a tile: 37 cm a course at 1.5 m a cell.
		return 1 / 2;
	}

	const decals = makeDecals();
	const std = (o) => new THREE.MeshStandardMaterial(o);
	const M = {
		wall: patch(std({ roughness: 0.92, metalness: 0.02 }), { stone: 'wall', shape: 'wall', reveal: 'rise' }),
		wallCap: patch(std({ roughness: 0.92, metalness: 0.02 }), { stone: 'stone', shape: 'cap' }),
		floor: patch(std({ roughness: 0.82, metalness: 0.02 }), { stone: 'stone', scale: 0.5 }),
		stone: patch(std({ roughness: 0.92, metalness: 0.02 }), { stone: 'stone', scale: 1 }),
		pillar: patch(std({ roughness: 0.86, metalness: 0.02 }), { stone: 'stone', scale: 1, shape: 'pillar', reveal: 'rise' }),
		ceiling: patch(std({ roughness: 0.98, metalness: 0 }), { stone: 'stone', scale: 0.45 }),
		beam: patch(std({ roughness: 0.9, metalness: 0 }), { stone: 'stone', scale: 1.4 }),
		trim: patch(std({ roughness: 0.38, metalness: 0.75 })),
		cloth: patch(std({ roughness: 1, metalness: 0, side: THREE.DoubleSide })),
		ice: patch(std({ roughness: 0.16, metalness: 0.02, transparent: true, opacity: 0.88 }), { shape: 'hang' }),
		iceShard: patch(std({ roughness: 0.16, metalness: 0.02, transparent: true, opacity: 0.88 })),
		moss: patch(std({ roughness: 1, metalness: 0, map: decals.moss, transparent: true, depthWrite: false })),
		bark: patch(std({ roughness: 0.95, metalness: 0 })),
	};
	const basic = (o) => {
		const m = new THREE.MeshBasicMaterial(o);
		m.toneMapped = false;
		return m;
	};
	const matGlow = patch(basic({ color: 0xffffff }), { lit: false });
	// Crystals: lit from inside, each facet its own brightness, with bright edges, so a shape reads as more than a flat colour.
	const matTag = patch(basic({ color: 0xffffff }), { lit: false, shape: 'tag' });
	const matCrystal = basic({ color: 0xffffff });
	matCrystal.customProgramCacheKey = () => 'crystal';
	matCrystal.onBeforeCompile = (s) => {
		s.vertexShader = `varying vec3 vWP2;\n${s.vertexShader}`.replace('#include <project_vertex>', `#include <project_vertex>
			{ mat4 mw = modelMatrix;
			#ifdef USE_INSTANCING
			mw = mw * instanceMatrix;
			#endif
			vWP2 = (mw * vec4(transformed, 1.0)).xyz; }`);
		s.fragmentShader = `varying vec3 vWP2;\n${s.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
			{
				vec3 n = normalize(cross(dFdx(vWP2), dFdy(vWP2)));
				vec3 v = normalize(cameraPosition - vWP2);
				float nv = abs(dot(n, v));
				float facet = 0.5 + 0.5 * sin(dot(n, vec3(5.1, 9.3, 7.7)));
				diffuseColor.rgb *= 0.34 + 0.5 * facet + 1.3 * pow(1.0 - nv, 2.5);
			}`);
	};
	const additive = (map, o = {}) => {
		const m = basic({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...o });
		return m;
	};
	const matCrack = additive(decals.crack);
	const matRune = additive(decals.rune, { side: THREE.DoubleSide, opacity: 0.85 });
	const matPortal = additive(decals.swirl, { opacity: 0.9 });
	const matShaft = additive(decals.shaft, { side: THREE.DoubleSide, opacity: 0.13 });
	const matSkirt = additive(decals.glow, { opacity: 0.5 });
	const matLiquid = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		uniforms: { uTime: U.uTime, uMode: { value: 0 }, uGlow: { value: 1 }, uOp: { value: 1 }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() } },
		vertexShader: `attribute vec2 aE; attribute vec4 aM; varying vec2 vP, vE; varying vec4 vM;
			void main(){ vP = vec2(position.x, position.z); vE = aE; vM = aM; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: LIQUID_FRAG,
	});
	const matPart = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		uniforms: { uTime: U.uTime, uPx: { value: 500 }, uKind: { value: 0 }, uColor: { value: new THREE.Color(0xffffff) } },
		vertexShader: PART_VERT,
		fragmentShader: `precision mediump float; uniform vec3 uColor; varying float vA;
			void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.12, d) * vA;
			gl_FragColor = vec4(uColor * (1.0 + 0.8*smoothstep(0.3, 0.0, d)), a); }`,
	});
	// A flame on a card that turns to face you, no two alike: rising noise bends a teardrop, white in the core and fading to the
	// theme's colour at the tips. Drawn the same from above and up close.
	const matFlame = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		uniforms: { uTime: U.uTime, uCol: { value: new THREE.Color(0xffa640) }, uCore: { value: new THREE.Color(0xfff3c8) }, uRevealT: U.uRevealT, uRevealC: U.uRevealC },
		vertexShader: `
			uniform float uRevealT; uniform vec2 uRevealC;
			varying vec2 vUvF; varying float vSeed;
			void main(){
				vec3 c = instanceMatrix[3].xyz;
				float s = length(instanceMatrix[0].xyz);
				float rk = clamp((uRevealT - length(c.xz - uRevealC) * 0.012 - 0.2) / 0.42, 0.0, 1.0);
				s *= rk;
				vec3 toCam = cameraPosition - c; toCam.y = 0.0; toCam = normalize(toCam + vec3(0.0001, 0.0, 0.0));
				vec3 right = vec3(toCam.z, 0.0, -toCam.x);
				vec3 p = c + right * position.x * 0.42 * s + vec3(0.0, 1.0, 0.0) * position.y * 0.66 * s;
				vSeed = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
				vUvF = vec2(position.x * 2.0, position.y);
				gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
			}`,
		fragmentShader: `
			precision highp float;
			uniform float uTime; uniform vec3 uCol, uCore;
			varying vec2 vUvF; varying float vSeed;
			float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
			float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
				return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
			float fbm(vec2 p){ return 0.55*vn(p)+0.3*vn(p*2.1+3.7)+0.15*vn(p*4.3+9.1); }
			void main(){
				float y = vUvF.y;
				float t = uTime * (1.5 + vSeed * 0.6) + vSeed * 40.0;
				float n = fbm(vec2(vUvF.x * 2.2 + vSeed * 17.0, y * 2.6 - t));
				float n2 = fbm(vec2(vUvF.x * 5.0 - vSeed * 5.0, y * 5.0 - t * 1.6));
				float x = vUvF.x + (n - 0.5) * 0.85 * y + (n2 - 0.5) * 0.3 * y;
				float tall = 0.72 + 0.2 * sin(t * 0.9) * sin(t * 0.37);
				float width = 0.52 * smoothstep(0.0, 0.12, y) * pow(max(0.0, 1.0 - y / tall), 0.72);
				float body = 1.0 - smoothstep(width * 0.3, width, abs(x));
				body *= smoothstep(0.0, 0.05, y) * (0.55 + 0.75 * n);
				float core = 1.0 - smoothstep(width * 0.1, width * 0.62, abs(x));
				core *= smoothstep(0.75, 0.15, y / tall);
				vec3 col = uCol * body * 2.1 + uCore * core * body * 2.0;
				gl_FragColor = vec4(col, body);
			}`,
	});

	// name -> geometry, material, shadow (0 none, 1 cast and receive, 2 receive), walk only.
	const G = makeGeometry();
	const DEFS = {
		floor: [G.floor, M.floor, 2],
		wall: [G.wall, M.wall, 1],
		wallCut: [G.wallCut, M.wall, 1],
		wallCap: [G.wallCap, M.wallCap, 1],
		capCut: [G.capCut, M.wallCap, 1],
		ceiling: [G.ceiling, M.ceiling, 0, true],
		beam: [G.beam, M.beam, 0, true],
		plinth: [G.plinth, M.stone, 0],
		pillar: [G.pillar, M.pillar, 1],
		arch: [G.archPost, M.stone, 1],
		archL: [G.archLintel, M.stone, 1],
		torchArm: [G.torch, M.trim, 0],
		flame: [G.flame, matFlame, 0],
		debrisA: [G.debrisA, M.stone, 2],
		debrisB: [G.debrisB, M.stone, 2],
		debrisC: [G.debrisC, M.stone, 2],
		chest: [G.chestBody, M.bark, 1],
		chestTrim: [G.chestTrim, M.trim, 0],
		chestGlow: [G.chestSeam, matGlow, 0],
		grave: [G.grave, M.stone, 1],
		sarco: [G.sarco, M.stone, 1],
		candle: [G.candle, M.bark, 0],
		bone: [G.bone, M.bark, 0],
		icicle: [G.icicle, M.ice, 0],
		shardIce: [G.shard, M.iceShard, 0],
		roots: [G.roots, M.bark, 1],
		moss: [G.moss, M.moss, 0],
		crackD: [G.crack, matCrack, 0],
		skirt: [G.skirt, matSkirt, 0],
		bannerRod: [G.bannerRod, M.trim, 0],
		bannerCloth: [G.bannerCloth, M.cloth, 0],
		emblem: [G.emblem, matGlow, 0],
		spawn1: [G.spawn1, M.stone, 1],
		spawn2: [G.spawn2, M.stone, 1],
		spawn3: [G.spawn3, M.stone, 1],
		band2: [G.band2, matTag, 0],
		band3: [G.band3, matTag, 0],
		markGem: [G.crystal, matTag, 0],
		crystal: [G.crystal, matCrystal, 0],
		ring: [G.ring, matGlow, 0],
		plinthS: [G.plinthS, M.stone, 1],
		post: [G.pillar, M.stone, 1],
		platform: [G.platform, M.stone, 2],
		brazier: [G.brazier, M.trim, 1],
		coals: [G.coals, matGlow, 0],
		basin: [G.basin, M.stone, 0],
		bossGlow: [G.bossShard, matCrystal, 0],
		bossRock: [G.bossShard, M.stone, 1],
	};
	const group = new THREE.Group();
	scene.add(group);
	const meshes = {};
	// Korean edition: switch whole kinds of dressing on and off.
	const layers = { props: true, torches: true, particles: true, liquids: true, lights: true };
	const LAYER_MESHES = {
		props: ['debrisA', 'debrisB', 'debrisC', 'chest', 'chestTrim', 'chestGlow', 'grave', 'sarco', 'candle', 'bone', 'icicle', 'shardIce', 'roots', 'moss', 'crackD', 'bannerRod', 'bannerCloth', 'emblem', 'brazier', 'coals', 'basin'],
		torches: ['torchArm', 'flame'],
	};
	const walkOnly = [];
	for (const [name, [geo, mat, shadow, inside]] of Object.entries(DEFS)) {
		const mesh = new THREE.InstancedMesh(geo, mat, 1);
		mesh.count = 0;
		mesh.frustumCulled = false;
		mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
		mesh.castShadow = shadow === 1;
		mesh.receiveShadow = shadow > 0;
		group.add(mesh);
		meshes[name] = mesh;
		if (inside) walkOnly.push(mesh);
	}

	// Single meshes: the entrance's portal, the boss's rune, shafts of light.
	const portal = new THREE.Mesh(G.portal, matPortal);
	matPortal.color.set(0x3fd0bb);
	const rune = new THREE.Mesh(G.runeRing, matRune);
	matRune.color.set(0xff5040);
	group.add(portal, rune);
	const shafts = new THREE.InstancedMesh(G.shaft, matShaft, 8);
	shafts.count = 0;
	shafts.frustumCulled = false;
	group.add(shafts);
	let liquids = [];
	let parts = null;
	let graph = null;
	let fieldTex = [];
	let curBg = new THREE.Color();
	let walkBg = new THREE.Color();
	let topFog = 0.002;
	let walkFog = new THREE.Color();
	let topFogCol = new THREE.Color();
	const baseHemi = { sky: new THREE.Color(), ground: new THREE.Color(), i: 0, dir: 0 };
	let curTheme = null;

	// Post: scene into a multisampled target, bright-pass, blur, then tilt-shift, grade, vignette, grain and gamma. Dungeon Forge's,
	// with tilt-shift fading out as you come down to eye height.
	const POST = (() => {
		const tri = new THREE.BufferGeometry();
		tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
		const qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		const mk = (mat) => {
			const s = new THREE.Scene();
			const q = new THREE.Mesh(tri, mat);
			q.frustumCulled = false;
			s.add(q);
			return s;
		};
		const V = 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
		const thresh = new THREE.ShaderMaterial({
			uniforms: { tS: { value: null } },
			vertexShader: V,
			fragmentShader: 'varying vec2 vUv; uniform sampler2D tS; void main(){ vec3 c = texture2D(tS, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114)); gl_FragColor = vec4(min(c, vec3(4.0)) * smoothstep(0.58, 0.95, l), 1.0); }',
			depthTest: false,
			depthWrite: false,
		});
		const blur = new THREE.ShaderMaterial({
			uniforms: { tS: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uRes: { value: new THREE.Vector2(1, 1) } },
			vertexShader: V,
			fragmentShader: `varying vec2 vUv; uniform sampler2D tS; uniform vec2 uDir, uRes;
				void main(){ vec2 px = uDir / uRes; vec3 c = texture2D(tS, vUv).rgb * 0.227;
				c += (texture2D(tS, vUv + px*1.384).rgb + texture2D(tS, vUv - px*1.384).rgb) * 0.316;
				c += (texture2D(tS, vUv + px*3.230).rgb + texture2D(tS, vUv - px*3.230).rgb) * 0.0703;
				gl_FragColor = vec4(c, 1.0); }`,
			depthTest: false,
			depthWrite: false,
		});
		const fin = new THREE.ShaderMaterial({
			uniforms: { tS: { value: null }, tB: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: U.uTime, uBloom: { value: 0.9 }, uTilt: { value: 1 }, uExposure: { value: 1 } },
			vertexShader: V,
			fragmentShader: `varying vec2 vUv; uniform sampler2D tS, tB; uniform vec2 uRes; uniform float uTime, uBloom, uTilt, uExposure;
				void main(){
					vec2 px = 1.0 / uRes;
					vec3 col = texture2D(tS, vUv).rgb;
					float band = smoothstep(0.15, 0.52, abs(vUv.y - 0.5)) * uTilt;
					float r = band * 3.4;
					vec3 b = col * 0.4;
					b += texture2D(tS, vUv + vec2( px.x*r,  px.y*r*0.6)).rgb * 0.15;
					b += texture2D(tS, vUv + vec2(-px.x*r,  px.y*r*0.6)).rgb * 0.15;
					b += texture2D(tS, vUv + vec2( px.x*r, -px.y*r*0.6)).rgb * 0.15;
					b += texture2D(tS, vUv + vec2(-px.x*r, -px.y*r*0.6)).rgb * 0.15;
					col = mix(col, b, min(1.0, band));
					col += texture2D(tB, vUv).rgb * uBloom;
					col *= uExposure;
					float lum = dot(col, vec3(0.299, 0.587, 0.114));
					col = mix(col, col * vec3(0.90, 0.97, 1.12), (1.0 - smoothstep(0.0, 0.4, lum)) * 0.38);
					col = mix(col, col * vec3(1.07, 1.01, 0.93), smoothstep(0.45, 1.0, lum) * 0.28);
					col = mix(vec3(lum), col, 1.09);
					col = (col - 0.5) * 1.05 + 0.5;
					float vg = smoothstep(1.35, 0.5, length(vUv - 0.5) * 1.55);
					col *= mix(0.78, 1.02, vg);
					float gr = fract(sin(dot(gl_FragCoord.xy + mod(uTime,10.0)*37.0, vec2(12.9898,78.233))) * 43758.5453);
					col += (gr - 0.5) * 0.02;
					col = pow(max(col, 0.0), vec3(0.4545));
					gl_FragColor = vec4(col, 1.0);
				}`,
			depthTest: false,
			depthWrite: false,
		});
		return { qcam, sThresh: mk(thresh), sBlur: mk(blur), sFinal: mk(fin), thresh, blur, fin, rtScene: null, rtA: null, rtB: null, w: 0, h: 0 };
	})();
	const size = new THREE.Vector2();
	function setupRTs() {
		renderer.getDrawingBufferSize(size);
		if (POST.w === size.x && POST.h === size.y && POST.rtScene) return;
		POST.w = size.x;
		POST.h = size.y;
		if (POST.rtScene) {
			POST.rtScene.dispose();
			POST.rtA.dispose();
			POST.rtB.dispose();
		}
		POST.rtScene = new THREE.WebGLRenderTarget(size.x, size.y, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 4 });
		const pb = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
		POST.rtA = new THREE.WebGLRenderTarget(Math.max(1, size.x >> 2), Math.max(1, size.y >> 2), pb);
		POST.rtB = new THREE.WebGLRenderTarget(Math.max(1, size.x >> 2), Math.max(1, size.y >> 2), pb);
	}
	const _bg = new THREE.Color();
	function renderFrame() {
		setupRTs();
		renderer.setClearColor(_bg.copy(curBg));
		renderer.setRenderTarget(POST.rtScene);
		renderer.clear();
		renderer.render(scene, camera);
		POST.thresh.uniforms.tS.value = POST.rtScene.texture;
		renderer.setRenderTarget(POST.rtA);
		renderer.render(POST.sThresh, POST.qcam);
		POST.blur.uniforms.uRes.value.set(POST.w >> 2, POST.h >> 2);
		// Two rounds, the second wider, so the glow has no visible edge round a flame.
		for (const spread of [1, 2.6]) {
			POST.blur.uniforms.tS.value = POST.rtA.texture;
			POST.blur.uniforms.uDir.value.set(spread, 0);
			renderer.setRenderTarget(POST.rtB);
			renderer.render(POST.sBlur, POST.qcam);
			POST.blur.uniforms.tS.value = POST.rtB.texture;
			POST.blur.uniforms.uDir.value.set(0, spread);
			renderer.setRenderTarget(POST.rtA);
			renderer.render(POST.sBlur, POST.qcam);
		}
		POST.fin.uniforms.tS.value = POST.rtScene.texture;
		POST.fin.uniforms.tB.value = POST.rtA.texture;
		POST.fin.uniforms.uRes.value.set(POST.w, POST.h);
		renderer.setRenderTarget(null);
		renderer.render(POST.sFinal, POST.qcam);
	}

	function setMasonry({ wall, stone }) {
		const tex = (arr, sz) => {
			const t = new THREE.DataTexture(arr, sz, sz, THREE.RGBAFormat);
			t.wrapS = t.wrapT = THREE.RepeatWrapping;
			t.minFilter = THREE.LinearMipmapLinearFilter;
			t.magFilter = THREE.LinearFilter;
			t.generateMipmaps = true;
			t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
			t.needsUpdate = true;
			return t;
		};
		U.tWall.value = tex(wall.color, wall.size);
		U.tWallN.value = tex(wall.normal, wall.size);
		U.tStone.value = tex(stone.color, stone.size);
		U.tStoneN.value = tex(stone.normal, stone.size);
	}

	function applyTheme(key) {
		const TH = THEMES[key];
		curTheme = key;
		topFogCol.set(TH.fog);
		walkFog.set(TH.walkFog);
		topFog = TH.fogD;
		walkBg.set(TH.walkFog);
		baseHemi.sky.set(TH.hemi[0]);
		baseHemi.ground.set(TH.hemi[1]);
		baseHemi.i = TH.hemi[2] * LIGHT_K;
		baseHemi.dir = TH.dir[1] * LIGHT_K;
		hemi.color.copy(baseHemi.sky);
		hemi.groundColor.copy(baseHemi.ground);
		dirL.color.set(TH.dir[0]);
		carried.color.set(TH.torchLight[0]).lerp(new THREE.Color(0xffffff), 0.35);
		matFlame.uniforms.uCol.value.set(TH.flame);
		matFlame.uniforms.uCore.value.set(TH.flameCore);
		if (TH.pools) {
			matLiquid.uniforms.uMode.value = TH.pools.mode;
			matLiquid.uniforms.uColA.value.set(TH.pools.colA);
			matLiquid.uniforms.uColB.value.set(TH.pools.colB);
			baseGlow = TH.pools.glow;
		}
		const pc = TH.particles;
		matPart.uniforms.uKind.value = pc.kind;
		matPart.uniforms.uColor.value.set(pc.color);
		curBgTop.set(TH.bg);
	}
	const curBgTop = new THREE.Color();
	let baseGlow = 1;

	function setLevel(d, level, { reveal = false } = {}) {
		applyTheme(d.params.theme);
		for (const [name, s] of Object.entries(level.sets)) {
			const m = meshes[name];
			m.dispose();
			m.instanceMatrix = new THREE.InstancedBufferAttribute(s.n ? s.m : new Float32Array(16), 16);
			m.instanceColor = new THREE.InstancedBufferAttribute(s.n ? s.c : new Float32Array(3), 3);
			m.count = s.n;
		}
		for (const l of liquids) {
			l.geometry.dispose();
			group.remove(l);
		}
		liquids = level.liquids.map((l) => {
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.BufferAttribute(l.pos, 3));
			g.setAttribute('aE', new THREE.BufferAttribute(l.ae, 2));
			g.setAttribute('aM', new THREE.BufferAttribute(l.am, 4));
			const mesh = new THREE.Mesh(g, matLiquid);
			mesh.frustumCulled = false;
			group.add(mesh);
			return mesh;
		});
		if (parts) {
			parts.geometry.dispose();
			group.remove(parts);
		}
		{
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.BufferAttribute(level.parts.pos, 3));
			g.setAttribute('aSeed', new THREE.BufferAttribute(level.parts.seed, 1));
			parts = new THREE.Points(g, matPart);
			parts.frustumCulled = false;
			group.add(parts);
		}
		portal.visible = Boolean(level.portal);
		if (level.portal) portal.position.set(level.portal[0], 0.135, level.portal[1]);
		rune.visible = Boolean(level.rune);
		if (level.rune) {
			rune.position.set(level.rune.x, 0.06, level.rune.z);
			rune.scale.setScalar(level.rune.s);
		}
		{
			const TH = THEMES[d.params.theme];
			const wx = (x) => x - d.W / 2 + 0.5;
			const wz = (y) => y - d.H / 2 + 0.5;
			const spots = [];
			for (const r of d.rooms) if (r.type === 'entrance') spots.push([wx(r.cx), wz(r.cy), 0.9]);
			for (const r of d.rooms) if (r.type === 'shrine') spots.push([wx(r.cx), wz(r.cy), 1]);
			if (TH.shafts) for (const r of d.rooms.filter((q) => q.type === 'combat' && !q.lake).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 2)) spots.push([wx(r.cx), wz(r.cy), 1.3]);
			shafts.count = Math.min(8, spots.length);
			for (let i = 0; i < shafts.count; i++) {
				const [x, z, s] = spots[i];
				_m.makeScale(s, s, s).setPosition(x, 0, z);
				shafts.setMatrixAt(i, _m);
			}
			shafts.instanceMatrix.needsUpdate = true;
		}
		for (const t of fieldTex) t.dispose();
		const mk = (arr) => {
			const t = new THREE.DataTexture(arr, level.field.w, level.field.h, THREE.RGBAFormat);
			t.minFilter = t.magFilter = THREE.LinearFilter;
			t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
			t.needsUpdate = true;
			return t;
		};
		fieldTex = [mk(level.field.color), mk(level.field.dir)];
		U.uField.value = fieldTex[0];
		U.uFieldDir.value = fieldTex[1];
		U.uFieldMap.value.set(1 / d.W, 1 / d.H, 0.5, 0.5);

		const shHalf = Math.max(d.W, d.H) * 0.62 + 6;
		dirL.shadow.camera.left = -shHalf;
		dirL.shadow.camera.right = shHalf;
		dirL.shadow.camera.top = shHalf;
		dirL.shadow.camera.bottom = -shHalf;
		dirL.shadow.camera.far = 400;
		dirL.shadow.camera.updateProjectionMatrix();
		renderer.shadowMap.needsUpdate = true;
		if (graph) {
			group.remove(graph);
			graph.geometry.dispose();
			graph = null;
		}
		const ent = d.rooms[d.entrance];
		U.uRevealC.value.set(ent.cx - d.W / 2 + 0.5, ent.cy - d.H / 2 + 0.5);
		U.uRevealT.value = reveal ? 0 : 1e6;
		return { reveal };
	}

	// Frame the dungeon as the map shows it: its rooms' corners seen along the map's heading.
	function frameMap(d) {
		const sin = Math.sin(rig.yaw);
		const cos = Math.cos(rig.yaw);
		let x0 = 1e9;
		let x1 = -1e9;
		let y0 = 1e9;
		let y1 = -1e9;
		for (const r of d.rooms) for (const [cx, cy] of [[r.x0, r.y0], [r.x1 + 1, r.y0], [r.x0, r.y1 + 1], [r.x1 + 1, r.y1 + 1]]) {
			const x = cx - d.W / 2;
			const z = cy - d.H / 2;
			const px = x * cos - z * sin;
			const py = (x * sin + z * cos) * Math.sin(rig.pitch);
			x0 = Math.min(x0, px);
			x1 = Math.max(x1, px);
			y0 = Math.min(y0, py);
			y1 = Math.max(y1, py);
		}
		const mx = (x0 + x1) / 2;
		const my = (y0 + y1) / 2 / Math.sin(rig.pitch);
		rig.target.set(mx * cos + my * sin, 0, -mx * sin + my * cos);
		rig.fitX = (x1 - x0) / 2 + 5;
		rig.fitY = (y1 - y0) / 2 + 7;
		rig.zoom = 1;
	}

	// The map's overlay: planned links in white, loops in blue, the critical path in red.
	function setGraph(d, on) {
		if (graph) {
			group.remove(graph);
			graph.geometry.dispose();
			graph = null;
		}
		if (!on || !d) return;
		const pos = [];
		const col = [];
		const wx = (x) => x - d.W / 2 + 0.5;
		const wz = (y) => y - d.H / 2 + 0.5;
		const tint = { tree: new THREE.Color(0xdfe4f0), loop: new THREE.Color(0x39d5e0), crit: new THREE.Color(0xff4d4d) };
		for (const e of d.edges) {
			const A = d.rooms[e.a];
			const B = d.rooms[e.b];
			pos.push(wx(A.cx), 2.8, wz(A.cy), wx(B.cx), 2.8, wz(B.cy));
			const c = e.isCritical ? tint.crit : e.isLoop ? tint.loop : tint.tree;
			col.push(c.r, c.g, c.b, c.r, c.g, c.b);
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
		graph = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false, fog: false }));
		graph.frustumCulled = false;
		graph.renderOrder = 5;
		group.add(graph);
	}

	// The camera: a long lens far away for the map (nearly flat, like a miniature), and at `t` = 1 a person's eye. `rig.t` runs
	// between them, so going in is one continuous move, and it can be turned back at any moment.
	const rig = { t: 0, target: new THREE.Vector3(), yaw: Math.PI / 4, pitch: 0.64, zoom: 1, size: 100, eye: new THREE.Vector3(0, EYE, 0), eyeYaw: 0, eyePitch: 0, fov: 72, bob: 0, aspect: 1, tiltOn: 1, light: 1, fitX: 50, fitY: 50 };
	const _f = new THREE.Vector3();
	const smooth = (x) => x * x * (3 - 2 * x);
	const FAR = 420;
	function applyCamera() {
		const k = rig.t;
		const dollyK = smooth(k);
		const fit = Math.max(rig.fitX / rig.aspect, rig.fitY, 8) / rig.zoom;
		const topFov = (2 * Math.atan2(fit, FAR) * 180) / Math.PI;
		const dist = FAR * (1 - dollyK) ** 2.2;
		const fov = THREE.MathUtils.lerp(topFov, rig.fov, smooth(Math.min(1, k * 1.1)) ** 1.6);
		// Coming down: first turn to face the way on and look nearly straight down, so the drop lands in the room and not through a
		// wall, then lift the eyes at the bottom.
		const lookK = smooth(THREE.MathUtils.clamp((k - 0.3) / 0.45, 0, 1));
		const liftK = smooth(THREE.MathUtils.clamp((k - 0.76) / 0.24, 0, 1));
		// Heading the short way round.
		let dy = (rig.eyeYaw - rig.yaw) % (Math.PI * 2);
		if (dy > Math.PI) dy -= Math.PI * 2;
		if (dy < -Math.PI) dy += Math.PI * 2;
		const yaw = rig.yaw + dy * lookK;
		const pitch = THREE.MathUtils.lerp(THREE.MathUtils.lerp(rig.pitch, 1.42, lookK), -rig.eyePitch, liftK);
		_f.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
		const aim = _p.copy(rig.target).lerp(rig.eye, smooth(Math.min(1, k / 0.7)));
		camera.position.copy(aim).addScaledVector(_f, dist);
		_s.copy(camera.position).sub(_f);
		camera.fov = fov;
		camera.near = Math.max(0.05, dist * 0.2);
		camera.far = k >= 1 ? 160 : Math.max(160, FAR * 2.5 * (1 - dollyK) + 160);
		camera.aspect = rig.aspect;
		camera.updateProjectionMatrix();
		camera.up.set(0, 1, 0);
		camera.lookAt(_s);
		camera.updateMatrixWorld();
		// Everything else follows the same dial.
		U.uRaise.value = smooth(THREE.MathUtils.clamp(k / 0.7, 0, 1));
		const inK = smooth(THREE.MathUtils.clamp((k - 0.55) / 0.45, 0, 1));
		POST.fin.uniforms.uTilt.value = rig.tiltOn * (1 - smooth(Math.min(1, k * 2.5)));
		POST.fin.uniforms.uExposure.value = THREE.MathUtils.lerp(1.22, 1.12, inK);
		scene.fog.color.lerpColors(topFogCol, walkFog, inK);
		scene.fog.density = Math.exp(THREE.MathUtils.lerp(Math.log(topFog), Math.log(0.036), inK));
		curBg.lerpColors(curBgTop, walkBg, inK);
		hemi.intensity = baseHemi.i * THREE.MathUtils.lerp(1, 0.34, inK);
		dirL.intensity = baseHemi.dir * (1 - inK);
		U.uFieldGain.value = THREE.MathUtils.lerp(1.1, 1, inK) * rig.light * (layers.lights ? 1 : 0.0);
		carried.intensity = inK * 1.7;
		carried.position.set(rig.eye.x, rig.eye.y + 0.25, rig.eye.z);
		const inside = camera.position.y < CEIL_TOP + 0.5;
		for (const m of walkOnly) m.visible = inside;
		for (const [name, list] of Object.entries(LAYER_MESHES)) for (const n of list) meshes[n].visible = layers[name];
		for (const l of liquids) l.visible = layers.liquids;
		if (parts) parts.visible = layers.particles;
		shafts.visible = k < 0.5;
		matShaft.opacity = 0.13 * (1 - Math.min(1, k * 2));
		// Liquids aren't lit, so ice and still water come down to the dim of the room inside. Lava keeps burning.
		matLiquid.uniforms.uGlow.value = THREE.MathUtils.lerp(baseGlow, baseGlow > 1 ? baseGlow : baseGlow * 0.35 - 0.1, inK);
		if (graph) graph.visible = k < 0.5;
		matPart.uniforms.uPx.value = (renderer.domElement.height / (2 * Math.tan((fov * Math.PI) / 360)));
	}

	function setPixelCap(cap) {
		pixelCap = cap;
		resize();
	}
	function resize() {
		const w = canvas.clientWidth || innerWidth;
		const h = canvas.clientHeight || innerHeight;
		// At most about 1080p's worth of pixels, whatever the window's size: a big window on a small card must start light.
		renderer.setPixelRatio(Math.min(devicePixelRatio, pixelCap, Math.sqrt(2200000 / Math.max(1, w * h))));
		renderer.setSize(w, h, false);
		rig.aspect = w / Math.max(1, h);
	}
	resize();

	return {
		renderer,
		scene,
		camera,
		rig,
		U,
		POST,
		meshes,
		layers,
		setMasonry,
		setLevel,
		setGraph,
		frameMap,
		setPixelCap,
		resize,
		get pixelCap() {
			return pixelCap;
		},
		get drawMaterials() {
			return [...Object.values(M), matGlow, matTag, matCrystal, matCrack, matRune, matPortal, matShaft, matSkirt, matLiquid, matPart, matFlame];
		},
		frame(time, dt) {
			U.uTime.value = time;
			if (U.uRevealT.value < 1e5) {
				U.uRevealT.value += dt;
				if (U.uRevealT.value > 3.2) U.uRevealT.value = 1e6;
			}
			portal.rotation.y = time * 0.55;
			rune.rotation.y = -time * 0.16;
			applyCamera();
			renderer.info.reset();
			renderFrame();
		},
	};
}
