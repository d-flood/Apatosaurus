import { sourceReadingIdOf, type StemmaTreeNode } from './collation-stemma';

/**
 * Geometry for a local stemma: layered top-down, roots at the top, viewport fitted to the
 * computed bounds. Pure and deterministic — no DOM, no store, no free node positioning.
 */

const NODE_WIDTH = 132;
const NODE_HEIGHT = 56;
const COLUMN_GAP = 24;
const ROW_GAP = 64;
const PADDING = 16;

export interface StemmaLayoutNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface StemmaLayoutArc {
	id: string;
	from: string;
	to: string;
	path: string;
}

export interface StemmaLayout {
	nodes: StemmaLayoutNode[];
	arcs: StemmaLayoutArc[];
	bounds: { width: number; height: number };
}

/** Layer each node one below its prior reading. Nodes in an arc cycle land in a trailing row. */
function assignRows(nodes: StemmaTreeNode[]): string[][] {
	const present = new Set(nodes.map(node => node.readingId));
	const sourceOf = new Map(
		nodes.map(node => {
			const source = sourceReadingIdOf(node);
			return [node.readingId, source && present.has(source) ? source : null] as const;
		})
	);

	const rowOf = new Map<string, number>();
	for (const node of nodes) {
		if (sourceOf.get(node.readingId) === null) rowOf.set(node.readingId, 0);
	}
	let placed = rowOf.size;
	for (let depth = 0; placed < nodes.length; depth += 1) {
		let progressed = false;
		for (const node of nodes) {
			if (rowOf.has(node.readingId)) continue;
			const source = sourceOf.get(node.readingId);
			if (source === null || source === undefined) continue;
			const sourceRow = rowOf.get(source);
			if (sourceRow === undefined) continue;
			rowOf.set(node.readingId, sourceRow + 1);
			placed += 1;
			progressed = true;
		}
		if (!progressed) break;
	}

	const rows: string[][] = [];
	const push = (row: number, id: string) => {
		while (rows.length <= row) rows.push([]);
		rows[row].push(id);
	};
	for (const node of nodes) {
		const row = rowOf.get(node.readingId);
		if (row !== undefined) push(row, node.readingId);
	}
	// Whatever an arc cycle left unplaced still has to be visible.
	const unplaced = nodes.filter(node => !rowOf.has(node.readingId));
	for (const node of unplaced) push(rows.length === 0 ? 0 : rows.length, node.readingId);

	// Keep each row beneath its own prior readings so arcs do not cross needlessly.
	for (let row = 1; row < rows.length; row += 1) {
		const parentOrder = new Map(rows[row - 1].map((id, index) => [id, index] as const));
		const originalOrder = new Map(rows[row].map((id, index) => [id, index] as const));
		rows[row].sort((a, b) => {
			const parentA = parentOrder.get(sourceOf.get(a) ?? '') ?? Number.MAX_SAFE_INTEGER;
			const parentB = parentOrder.get(sourceOf.get(b) ?? '') ?? Number.MAX_SAFE_INTEGER;
			if (parentA !== parentB) return parentA - parentB;
			return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
		});
	}
	return rows;
}

function rowWidth(count: number): number {
	return count * NODE_WIDTH + Math.max(0, count - 1) * COLUMN_GAP;
}

export function layoutLocalStemma(nodes: StemmaTreeNode[]): StemmaLayout {
	if (nodes.length === 0) {
		return { nodes: [], arcs: [], bounds: { width: 0, height: 0 } };
	}

	const rows = assignRows(nodes);
	const widest = Math.max(...rows.map(row => rowWidth(row.length)));
	const placed = new Map<string, StemmaLayoutNode>();
	rows.forEach((row, rowIndex) => {
		const left = PADDING + Math.round((widest - rowWidth(row.length)) / 2);
		row.forEach((id, columnIndex) => {
			placed.set(id, {
				id,
				x: left + columnIndex * (NODE_WIDTH + COLUMN_GAP),
				y: PADDING + rowIndex * (NODE_HEIGHT + ROW_GAP),
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
			});
		});
	});

	const arcs: StemmaLayoutArc[] = [];
	for (const node of nodes) {
		const from = sourceReadingIdOf(node);
		if (!from) continue;
		const prior = placed.get(from);
		const posterior = placed.get(node.readingId);
		if (!prior || !posterior) continue;
		const x1 = prior.x + prior.width / 2;
		const y1 = prior.y + prior.height;
		const x2 = posterior.x + posterior.width / 2;
		const y2 = posterior.y;
		const bend = Math.max(ROW_GAP / 2, (y2 - y1) / 2);
		arcs.push({
			id: `${from}->${node.readingId}`,
			from,
			to: node.readingId,
			path: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`,
		});
	}

	return {
		nodes: nodes
			.map(node => placed.get(node.readingId))
			.filter((node): node is StemmaLayoutNode => node !== undefined),
		arcs,
		bounds: {
			width: widest + PADDING * 2,
			height: rows.length * NODE_HEIGHT + (rows.length - 1) * ROW_GAP + PADDING * 2,
		},
	};
}
