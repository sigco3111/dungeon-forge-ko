---
kind: system
engine: three
---

# Dungeons

Forges a dungeon from a seed: rooms with roles (entrance, combat, elite, treasure, shrine, boss), corridors that always connect them, and five themes. You get plain data, a grid and a room list, for any game, plus a three.js view you can walk in first person.

In the live demo, you see the dungeon from above. Press Enter to go down and walk it: WASD walks, Shift runs, the mouse looks, scroll zooms, and Enter comes back up. Esc only lets the mouse go, and a click takes it back. Pick a theme and move Rooms and Loops to forge another.

## What this owns

- **Renderer:** WebGL, in the view only. `src/generator.js`, `src/walker.js` and `src/level.js` use no three.js. `createView(canvas)` in `src/view.js` makes its own `WebGLRenderer`, at `view.renderer`.
- **Frame loop:** The data draws nothing: read `generateDungeon`'s output and call `walker.step(...)` from your own loop. The view draws the whole frame with `view.frame(time, dt)`, through its own render targets and post-processing. Other things go in `view.scene`.
- **three:** `package.json` pins 0.186.1, and only `src/view.js` imports it. No other library has to match.
- **Copy:** `src/generator.js` for the data, plus `src/walker.js` to walk it. For the view, add `src/level.js`, `src/themes.js` and `src/view.js`, and `src/masonry.js` and `src/build-worker.js`, which make what the demo gives `view.setMasonry` and `view.setLevel`.
- **Elsewhere:** `createView` sets its renderer to linear output with no tone mapping. `src/build-worker.js` is a module worker, so Vite needs `worker: { format: 'es' }`.

## Credits

It's [Dungeon Forge](https://github.com/majidmanzarpour/threejs-procedural-dungeon) by [Majid Manzarpour](https://x.com/majidmanzarpour) (MIT, © 2026 Majid Manzarpour, [live demo](https://procedural-dungeon.netlify.app)), split into a generator and a view at commit `0a2aa09`. The generator, room roles, themes, geometry kit, liquids, particles and post-processing are his. Please keep `LICENSE-dungeon-forge.txt` if you ship it.

Patch added corridor routing, the walk, ceilings, cut corners, stone, flames and the light field. Everything is made in code: no textures, models or sounds. Licences go in `dist/licenses/` with every build. three.js is 0.186.1.

## Generate a dungeon

`src/generator.js` is one file with no imports, and it runs in a browser, a worker or Node.

```js
import { asciiMap, cellToWorld, FLOOR, generateDungeon } from './src/generator.js';

const d = generateDungeon({ seed: 1337, rooms: 24, loops: 0.3, decor: 0.6, theme: 'grim' });

d.valid;                     // true: every floor cell was reached from the entrance
d.W; d.H;                    // the grid's size, in cells
d.grid[y * d.W + x];         // VOID 0, FLOOR 1, WALL 2, POOL 3 (sunken liquid, not walkable)
d.walkable[y * d.W + x];     // 1 if you can stand on the cell's middle, for your own pathfinding
d.roomId[y * d.W + x];       // which room a cell belongs to, or -1 in a corridor

const boss = d.rooms[d.boss];
boss.type;                   // 'entrance', 'combat', 'elite', 'treasure', 'shrine' or 'boss'
boss.cx; boss.cy;            // its middle
boss.x0; boss.y0; boss.x1; boss.y1; // its bounds
boss.depth; boss.difficulty; // rooms from the entrance, and 0 to 1 towards the boss
boss.critical;               // on the shortest way from entrance to boss

d.path;                      // the room ids of that shortest way
d.edges;                     // { a, b, isLoop, isCritical, width }: exactly the links you can walk
d.spawns;                    // { x, y, tier, roomId, radius }: where enemies could start; tier 1 to 3
d.props;                     // { kind, x, y, rot, scale, radius? }: chests, pillars, graves. radius means solid
d.torches;                   // { x, y, dx, dy }: a wall cell, and which way it faces

for (const s of d.spawns) {
	const { x, z } = cellToWorld(d, s.x, s.y, 1.5); // 1.5 m a cell is a good human scale
	spawnEnemy(x, z, s.tier);                        // your code
}

console.log(asciiMap(d));    // the whole map as text, handy for an agent
```

- **Same input, same dungeon,** in every browser and in Node. There's no `Math.random` and no clock in it.
- **A theme never changes the floor plan.** Reskin a level you like. Pools, lakes, spawns and props do change with it; rooms and corridors don't. A pit only ever takes a cell inside a room, so it can't cut anything off.
- **The graph is the truth.** If two corridors cross, that shortcut is added to `edges` with `merged: true`, and roles and `path` follow it.
- **Rooms of 12 or more** get at least one elite, treasure and shrine room if the layout has space. Below 12, some roles may be missing.
- **Time:** about 3 to 9 ms for 12 rooms, 10 to 17 ms for 24, and 20 to 50 ms for 60 (worst seen 66 ms), on one fast desktop core. Baking the light takes longer, so a live demo does it all in a worker, as `src/build-worker.js` does.
- **A loop that would cross another corridor is left out,** because crossing corridors join everything they touch. So Loops at 100% means "as many as fit". A few of the corridors that must exist still cross; those are the `merged` ones. With many loops on few rooms, the boss can be close: in 1 of 30 dungeons at 12 rooms, it was one room from the entrance.

## Walk it, or draw it

`src/walker.js` is a round body that slides along walls, cut corners and solid props. It needs only the generator's output, plus `cut` if you use the view's cut corners (`buildLevel` adds it).

```js
import { createWalker } from './src/walker.js';

const walker = createWalker(d);
walker.start();                                 // in the entrance, facing the way on
// every frame, in cells a second (2.9 is about 4.3 m/s at 1.5 m a cell):
walker.step(dt, forward, strafe, 2.9);          // forward and strafe from -1 to 1
camera.position.set(walker.x, 1.07, walker.z);  // world units are cells, with the dungeon centred
camera.rotation.set(walker.pitch, walker.yaw, 0, 'YXZ');
walker.room();                                  // the room you're in, or null in a corridor
```

`src/level.js` turns a dungeon into instance lists and a baked light picture, with no three.js in it, so a worker can do it. `src/view.js` draws them (`createView(canvas)`, `view.setMasonry`, `view.setLevel`, `view.frame`); `src/demo.js` shows how to use it all. Going to your own art? Read the grid and put your wall pieces on `WALL` cells that touch `FLOOR`, and your props on `d.props`.

**The light field** is the part worth taking. Every lamp is baked into a top-down picture of the level, with shadows stopping at walls, and materials read it with two texture lookups. So every torch in the dungeon lights the stone, light doesn't leak through walls, and a laptop pays the same as a big card. Its price: it's 2D. Lamps can't move, and a thing moving past a torch casts no shadow.

## What it's bad at

- **Flat only.** One floor, no stairs and no height changes. Rooms are rectangles, ellipses and octagons, and walls stay on the grid (with corners cut at 45° in the view).
- **It's a level, not a game.** No enemies, doors that open, loot or sound. Spawns and chests are data for you to act on. Nothing in the demo moves or fights.
- **Big maps are long walks.** 24 rooms is about 200 m across at 1.5 m a cell. It's made for a level you cross in minutes, not a world.
- **Loops at 0% can still have a few.** Corridors that have to cross become real links, so it's "few", not "none": about 3 for 24 rooms. `stats.merged` tells you how many.
- **Long corridors repeat.** Stone is one tiling picture and dressing is sparse in corridors. Up close and for long, you'll want your own art, or more props.
- **The first-person view draws everything every frame,** with no room culling, though in only about 50 draw calls: about 200,000 triangles at 24 rooms and 500,000 at 60. A shipped game should hide rooms it can't see.
- **Only tried on an RTX 4090.** The demo lowers its resolution by itself if frames get slow, but no real laptop has run it.

## Controls

<!-- controls -->
**For people** (the block page shows these):

| id | Control | Type | Range | What it does |
|---|---|---|---|---|
| `theme` | Theme | choice | `ancient`, `molten`, `frost`, `grim`, `verdant`; default `molten` | The look: stone, light, liquid and dressing. The floor plan stays the same, so you can reskin a level you like. |
| `rooms` | Rooms | number | 8 to 60, default 24 | How many rooms to forge. |
| `loops` | Loops | number | 0 to 100%, default 30 | How often rooms get a second way in. None gives branches and dead ends; many gives shortcuts and circuits. |

Triggers: `new` (New dungeon): A new seed: the same settings, forged differently. `walk` (Walk it): Go down and walk it in first person, or come back to the map. Enter does the same. `reset` (Reset): Everything back to the start: every control at its default, the first dungeon, and the map view.

**For agents** (steer them over the channel):

| id | Control | Type | Range | What it does |
|---|---|---|---|---|
| `seed` | Seed | number | 0 to 999999, default 1337 | The same seed, rooms and loops always forge the same floor plan. |
| `decor` | Rubble | number | 0 to 100%, default 60 | How much loose stone, moss and bone lies around. |
| `view` | View | choice | `map`, `walk`; default `map` | From above, or walking it at eye height. |
| `graph` | Room links | toggle | default false | Draws the room graph over the map: the critical path in red, loops in blue. |
| `light` | Torchlight | number | 0.2 to 2.5×, default 1 | How bright every lamp in the dungeon burns. |
| `bloom` | Bloom | number | 0 to 2, default 0.9 | The glow around flames and lava. |
| `tilt` | Miniature focus | number | 0 to 1, default 1 | How much the map blurs at top and bottom, like a photo of a model. Not used when walking. |
<!-- /controls -->

## Checks

`npm test` runs `tools/check-generator.mjs`: repeatable, the same plan in every theme, the graph equal to what you can walk, and a body fitting everywhere. `node tools/check-walk.mjs` has a bot walk to every room with the real walker. `node tools/moves-check.mjs` plays a first minute with a real mouse and keyboard inside a cross-origin frame. `node tools/soak.mjs` plays hard for minutes in real Chrome. `node tools/readme-check.mjs` runs the code above.
