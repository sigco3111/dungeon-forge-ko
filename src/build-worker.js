// Generates dungeons and bakes their light away from the page, so nothing a person does can stall a frame.
import { generateDungeon } from './generator.js';
import { buildLevel, transferList } from './level.js';
import { ashlar, rough } from './masonry.js';

self.onmessage = ({ data }) => {
	if (data.type === 'masonry') {
		const wall = ashlar(1024);
		const stone = rough(512);
		self.postMessage({ type: 'masonry', wall, stone }, [wall.color.buffer, wall.normal.buffer, stone.color.buffer, stone.normal.buffer]);
		return;
	}
	const t0 = performance.now();
	const dungeon = generateDungeon(data.params);
	const t1 = performance.now();
	const level = buildLevel(dungeon, { heat: Boolean(data.params.heat) });
	self.postMessage({ type: 'level', id: data.id, dungeon, level, ms: { generate: t1 - t0, dress: performance.now() - t1 } }, transferList(level));
};
