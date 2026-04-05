export type DiffSegmentKind = 'equal' | 'insert' | 'delete' | 'replace';

export interface DiffSegment {
	kind: DiffSegmentKind;
	text: string;
	spacing?: 'word' | 'none';
}

function tokenize(text: string | null): string[] {
	if (!text) return [];
	return text
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

function compactSegments(segments: DiffSegment[]): DiffSegment[] {
	if (segments.length === 0) return segments;
	const compacted: DiffSegment[] = [];
	for (const segment of segments) {
		const prev = compacted[compacted.length - 1];
		if (prev && prev.kind === segment.kind) {
			const spacing = segment.spacing ?? 'word';
			prev.text = spacing === 'none' ? `${prev.text}${segment.text}` : `${prev.text} ${segment.text}`;
		} else {
			compacted.push({ ...segment });
		}
	}
	return compacted;
}

function computeCharSemanticDiff(baseWord: string, witnessWord: string): DiffSegment[] {
	const a = [...baseWord];
	const b = [...witnessWord];
	const m = a.length;
	const n = b.length;
	if (m === 0 && n === 0) return [];
	if (m === 0) return [{ kind: 'insert', text: witnessWord, spacing: 'none' }];
	if (n === 0) return [{ kind: 'delete', text: baseWord, spacing: 'none' }];

	const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
			else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const raw: DiffSegment[] = [];
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (a[i] === b[j]) {
			raw.push({ kind: 'equal', text: a[i], spacing: 'none' });
			i++;
			j++;
			continue;
		}
		if (dp[i + 1][j] >= dp[i][j + 1]) {
			raw.push({ kind: 'delete', text: a[i], spacing: 'none' });
			i++;
		} else {
			raw.push({ kind: 'insert', text: b[j], spacing: 'none' });
			j++;
		}
	}
	while (i < m) raw.push({ kind: 'delete', text: a[i++], spacing: 'none' });
	while (j < n) raw.push({ kind: 'insert', text: b[j++], spacing: 'none' });

	const compact = compactSegments(raw);
	const semantic: DiffSegment[] = [];
	for (let k = 0; k < compact.length; k++) {
		const cur = compact[k];
		const nxt = compact[k + 1];
		const pair =
			nxt &&
			((cur.kind === 'delete' && nxt.kind === 'insert') ||
				(cur.kind === 'insert' && nxt.kind === 'delete'));
		if (pair) {
			semantic.push({
				kind: 'replace',
				text: cur.kind === 'insert' ? cur.text : nxt.text,
				spacing: 'none',
			});
			k++;
			continue;
		}
		semantic.push(cur);
	}
	return semantic;
}

// Computes a simple word-level diff using LCS to align unchanged tokens.
export function computeWordDiff(baseText: string | null, witnessText: string | null): DiffSegment[] {
	const baseTokens = tokenize(baseText);
	const witnessTokens = tokenize(witnessText);
	const m = baseTokens.length;
	const n = witnessTokens.length;

	if (m === 0 && n === 0) return [];
	if (m === 0) return [{ kind: 'insert', text: witnessTokens.join(' '), spacing: 'word' }];
	if (n === 0) return [{ kind: 'delete', text: baseTokens.join(' '), spacing: 'word' }];

	const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			if (baseTokens[i] === witnessTokens[j]) {
				dp[i][j] = dp[i + 1][j + 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}
	}

	const segments: DiffSegment[] = [];
	let i = 0;
	let j = 0;

	while (i < m && j < n) {
		if (baseTokens[i] === witnessTokens[j]) {
			segments.push({ kind: 'equal', text: baseTokens[i], spacing: 'word' });
			i++;
			j++;
			continue;
		}

		if (dp[i + 1][j] >= dp[i][j + 1]) {
			segments.push({ kind: 'delete', text: baseTokens[i], spacing: 'word' });
			i++;
		} else {
			segments.push({ kind: 'insert', text: witnessTokens[j], spacing: 'word' });
			j++;
		}
	}

	while (i < m) {
		segments.push({ kind: 'delete', text: baseTokens[i++], spacing: 'word' });
	}
	while (j < n) {
		segments.push({ kind: 'insert', text: witnessTokens[j++], spacing: 'word' });
	}

	const wordDiff = compactSegments(segments);
	const refined: DiffSegment[] = [];
	for (let k = 0; k < wordDiff.length; k++) {
		const cur = wordDiff[k];
		const nxt = wordDiff[k + 1];
		const pair =
			nxt &&
			((cur.kind === 'delete' && nxt.kind === 'insert') ||
				(cur.kind === 'insert' && nxt.kind === 'delete'));
		if (pair && !/\s/.test(cur.text) && !/\s/.test(nxt.text)) {
			const baseWord = cur.kind === 'delete' ? cur.text : nxt.text;
			const witnessWord = cur.kind === 'insert' ? cur.text : nxt.text;
			refined.push(...computeCharSemanticDiff(baseWord, witnessWord));
			k++;
			continue;
		}
		refined.push(cur);
	}

	return refined;
}
