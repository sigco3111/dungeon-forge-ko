// Runs the README's generator and walker code in plain Node, with no view: node tools/readme-check.mjs
import { asciiMap, cellToWorld, FLOOR, generateDungeon, worldToCell } from '../src/generator.js';
import { createWalker } from '../src/walker.js';

const d = generateDungeon({ seed: 1337, rooms: 24, loops: 0.3, decor: 0.6, theme: 'grim' });
const check = (name, ok) => {
	console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
	if (!ok) process.exitCode = 1;
};
check('valid', d.valid === true);
check('grid has floor', d.grid.includes(FLOOR));
check('walkable grid', d.walkable.length === d.W * d.H && d.walkable.includes(1));
const boss = d.rooms[d.boss];
check('boss room', boss.type === 'boss' && boss.critical && boss.x1 >= boss.x0 && boss.difficulty === 1);
check('path runs entrance to boss', d.path[0] === d.entrance && d.path.at(-1) === d.boss);
check('edges', d.edges.every((e) => Number.isInteger(e.a) && Number.isInteger(e.b) && typeof e.isLoop === 'boolean' && e.width >= 1));
check('spawns', d.spawns.length > 0 && d.spawns.every((s) => s.tier >= 1 && s.tier <= 3 && s.radius > 0));
check('solid props say so', d.props.some((p) => p.radius > 0));
check('torches', d.torches.length > 0);
const s = d.spawns[0];
const { x, z } = cellToWorld(d, s.x, s.y, 1.5);
const c = worldToCell(d, x, z, 1.5);
check('cell to world and back', c.x === s.x && c.y === s.y);
check('map as text', asciiMap(d).split('\n').length === d.H && asciiMap(d).includes('B') && asciiMap(d).includes('E'));
check('plain JSON survives', JSON.stringify({ rooms: d.rooms, edges: d.edges, props: d.props }).length > 100);
// Without buildLevel, so with no cut corners.
const walker = createWalker(d);
walker.start();
check('starts in the entrance', walker.room()?.type === 'entrance');
const x0 = walker.x;
const z0 = walker.z;
for (let i = 0; i < 30; i++) walker.step(1 / 60, 1, 0, 2.9);
check('walks', Math.hypot(walker.x - x0, walker.z - z0) > 0.5);
