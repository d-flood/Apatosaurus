import type {
	CanvasRef,
	IntfAutoLinkAssignment,
	IntfAutoLinkCanvas,
	IntfAutoLinkPage,
	IntfAutoLinkResult,
	PageRef,
	SmartLinkPlan,
} from './types';

export function createSmartLinkPlan(input: {
	pages: PageRef[];
	canvases: CanvasRef[];
	startPageId: string;
	endPageId: string;
	startCanvasId: string;
	endCanvasId: string;
}): SmartLinkPlan {
	const startPageIndex = input.pages.findIndex(page => page.pageId === input.startPageId);
	const endPageIndex = input.pages.findIndex(page => page.pageId === input.endPageId);
	const startCanvasIndex = input.canvases.findIndex(canvas => canvas.canvasId === input.startCanvasId);
	const endCanvasIndex = input.canvases.findIndex(canvas => canvas.canvasId === input.endCanvasId);

	if (startPageIndex === -1 || endPageIndex === -1 || startCanvasIndex === -1 || endCanvasIndex === -1) {
		return {
			status: 'invalid',
			assignments: [],
			pageCount: 0,
			canvasCount: 0,
			message: 'Choose both page and canvas ranges before previewing a smart link.',
		};
	}

	if (endPageIndex < startPageIndex || endCanvasIndex < startCanvasIndex) {
		return {
			status: 'invalid',
			assignments: [],
			pageCount: 0,
			canvasCount: 0,
			message: 'Ending selections must come after their corresponding starting selections.',
		};
	}

	const pageSlice = input.pages.slice(startPageIndex, endPageIndex + 1);
	const canvasSlice = input.canvases.slice(startCanvasIndex, endCanvasIndex + 1);

	if (pageSlice.length !== canvasSlice.length) {
		return {
			status: 'mismatch',
			assignments: [],
			pageCount: pageSlice.length,
			canvasCount: canvasSlice.length,
			message: `The selected ranges contain ${pageSlice.length} page(s) and ${canvasSlice.length} canvas(es). Smart linking requires the counts to match.`,
		};
	}

	return {
		status: 'ready',
		assignments: pageSlice.map((page, index) => ({
			page,
			canvas: canvasSlice[index],
		})),
		pageCount: pageSlice.length,
		canvasCount: canvasSlice.length,
		message: `Ready to link ${pageSlice.length} page(s) to ${canvasSlice.length} canvas(es).`,
	};
}

interface NormalizedFolioToken {
	raw: string;
	normalized: string;
	number: string | null;
	side: 'r' | 'v' | null;
}

interface CandidateScore {
	score: number;
	matchedOn: string;
}

interface CandidateMatch extends CandidateScore {
	canvas: IntfAutoLinkCanvas;
}

export function normalizeFolioToken(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	let normalized = trimmed.toLowerCase();
	normalized = normalized.replace(/\b(recto)\b/g, 'r');
	normalized = normalized.replace(/\b(verso)\b/g, 'v');
	normalized = normalized.replace(/\b(folio|fol\.|fol|f\.)\s*/g, '');
	normalized = normalized.replace(/[\s._-]+/g, '');
	const match = normalized.match(/^(\d+)([rv])?$/);
	if (match) {
		const numberPart = String(Number(match[1]));
		return `${numberPart}${match[2] || ''}`;
	}
	return normalized.replace(/^0+(?=\d)/, '');
}

function parseNormalizedFolio(value: string | null | undefined): NormalizedFolioToken | null {
	const normalized = normalizeFolioToken(value);
	if (!normalized) return null;
	const match = normalized.match(/^(\d+)([rv])?$/);
	return {
		raw: value || normalized,
		normalized,
		number: match?.[1] || null,
		side: match?.[2] === 'r' || match?.[2] === 'v' ? match[2] : null,
	};
}

function scoreMatch(
	pageToken: NormalizedFolioToken,
	canvasToken: NormalizedFolioToken,
	matchedOn: string
): CandidateScore | null {
	if (pageToken.normalized === canvasToken.normalized) {
		return { score: matchedOn === 'folio' ? 100 : 95, matchedOn };
	}
	if (pageToken.number && canvasToken.number && pageToken.number === canvasToken.number) {
		const score = pageToken.side && canvasToken.side ? 0 : 40;
		if (score > 0) {
			return { score, matchedOn: `${matchedOn}-number` };
		}
	}
	return null;
}

function getCanvasTokens(canvas: IntfAutoLinkCanvas): Array<{ token: NormalizedFolioToken; matchedOn: string }> {
	const sources = [
		{ value: canvas.folio, matchedOn: 'folio' },
		{ value: canvas.shelfFolioNums, matchedOn: 'shelfFolioNums' },
		{ value: canvas.canvasLabel, matchedOn: 'canvasLabel' },
	];
	const seen = new Set<string>();
	const tokens: Array<{ token: NormalizedFolioToken; matchedOn: string }> = [];
	for (const source of sources) {
		const token = parseNormalizedFolio(source.value);
		if (!token || seen.has(token.normalized)) continue;
		seen.add(token.normalized);
		tokens.push({ token, matchedOn: source.matchedOn });
	}
	return tokens;
}

export function createIntfAutoLinkPlan(input: {
	pages: IntfAutoLinkPage[];
	canvases: IntfAutoLinkCanvas[];
	minimumScore?: number;
}): IntfAutoLinkResult {
	const minimumScore = input.minimumScore ?? 95;
	const assignments: IntfAutoLinkAssignment[] = [];
	const usedCanvasIds = new Set<string>();
	let ambiguousCount = 0;
	let skippedCount = 0;

	const canvasTokenMap = new Map<string, Array<{ token: NormalizedFolioToken; matchedOn: string }>>();
	for (const canvas of input.canvases) {
		canvasTokenMap.set(canvas.canvasId, getCanvasTokens(canvas));
	}

	const pages = [...input.pages].sort((a, b) => a.pageOrder - b.pageOrder);
	for (const page of pages) {
		const pageTokens = page.matchCandidates
			.map(candidate => parseNormalizedFolio(candidate))
			.filter((candidate): candidate is NormalizedFolioToken => Boolean(candidate));
		if (pageTokens.length === 0) {
			skippedCount += 1;
			continue;
		}

		const matches: CandidateMatch[] = [];
		for (const canvas of input.canvases) {
			if (usedCanvasIds.has(canvas.canvasId)) continue;
			const canvasTokens = canvasTokenMap.get(canvas.canvasId) || [];
			let best: CandidateMatch | null = null;
			for (const pageToken of pageTokens) {
				for (const canvasToken of canvasTokens) {
					const scored = scoreMatch(pageToken, canvasToken.token, canvasToken.matchedOn);
					if (!scored) continue;
					const next = { ...scored, canvas };
					if (
						!best ||
						next.score > best.score ||
						(next.score === best.score && canvas.canvasOrder < best.canvas.canvasOrder)
					) {
						best = next;
					}
				}
			}
			if (best) matches.push(best);
		}

		matches.sort((a, b) => b.score - a.score || a.canvas.canvasOrder - b.canvas.canvasOrder);
		const top = matches[0];
		if (!top || top.score < minimumScore) {
			skippedCount += 1;
			continue;
		}
		const equallyGood = matches.filter(match => match.score === top.score);
		if (equallyGood.length > 1) {
			ambiguousCount += 1;
			continue;
		}

		usedCanvasIds.add(top.canvas.canvasId);
		assignments.push({
			page,
			canvas: top.canvas,
			score: top.score,
			matchedOn: top.matchedOn,
		});
	}

	const matchedCount = assignments.length;
	const message = `Auto-associated ${matchedCount} page(s); skipped ${skippedCount} and left ${ambiguousCount} ambiguous.`;
	return {
		assignments,
		matchedCount,
		ambiguousCount,
		skippedCount,
		message,
	};
}
