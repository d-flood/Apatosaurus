import { alignmentCellFromTokens } from './alignment-cell';
import type { AlignmentCell, AlignmentColumn } from './alignment-snapshot';
import type { CollationWitnessInput } from './collation-worker-types';
import { joinTokenTexts, tokenizeDisplayText } from './token-text';

const gapCost = 3;
const substitutionCost = 2;

function insertionAbsence(
	left: AlignmentCell | undefined,
	right: AlignmentCell | undefined
): AlignmentCell {
	const kind =
		left?.kind === 'untranscribed' && right?.kind === 'untranscribed'
			? 'untranscribed'
			: (left?.kind === 'gap' || left?.kind === 'untranscribed') &&
				  (right?.kind === 'gap' || right?.kind === 'untranscribed')
				? 'gap'
				: 'omission';
	return {
		...alignmentCellFromTokens([]),
		kind,
		isOmission: kind === 'omission',
		isLacuna: kind !== 'omission',
	};
}

export function placeWitnessRow(
	columns: AlignmentColumn[],
	witness: CollationWitnessInput,
	options: { witnessOrder: string[]; makeId?: () => string }
): { columns: AlignmentColumn[]; insertedColumnIds: string[] } {
	const tokens =
		witness.tokens ??
		tokenizeDisplayText(witness.content).map(text => ({ t: text, n: text.toLowerCase() }));
	const makeId = options.makeId ?? (() => crypto.randomUUID());
	const costs = Array.from({ length: columns.length + 1 }, () =>
		new Array<number>(tokens.length + 1).fill(Infinity)
	);
	const steps = Array.from({ length: columns.length + 1 }, () =>
		new Array<number>(tokens.length + 1).fill(0)
	);
	costs[0][0] = 0;
	for (let tokenEnd = 1; tokenEnd <= tokens.length; tokenEnd++) {
		costs[0][tokenEnd] = tokenEnd * gapCost;
		steps[0][tokenEnd] = -1;
	}
	for (let columnEnd = 1; columnEnd <= columns.length; columnEnd++) {
		const column = columns[columnEnd - 1];
		const values = [...column.cells]
			.filter(([id, cell]) => id !== witness.id && cell.kind === 'text')
			.map(([, cell]) => cell.alignmentValue)
			.filter((value): value is string => value !== null);
		const widths = values.map(value => value.trim().split(/\s+/).length);
		const takesRun = column.merged || widths.some(width => width > 1);
		for (let tokenEnd = 0; tokenEnd <= tokens.length; tokenEnd++) {
			let best = Infinity;
			let step = 0;
			for (
				let length = 1;
				length <= (takesRun ? tokenEnd : Math.min(1, tokenEnd));
				length++
			) {
				const run = tokens.slice(tokenEnd - length, tokenEnd);
				const value = joinTokenTexts(run.map(token => ({ ...token, text: token.n })));
				const width = value.trim().split(/\s+/).length;
				const penalty = values.includes(value)
					? 0
					: substitutionCost +
						gapCost *
							Math.min(
								...(widths.length ? widths : [1]).map(w => Math.abs(w - width))
							);
				const cost = costs[columnEnd - 1][tokenEnd - length] + penalty;
				if (cost < best) {
					best = cost;
					step = length;
				}
			}
			const omission = costs[columnEnd - 1][tokenEnd] + gapCost;
			if (omission < best) {
				best = omission;
				step = 0;
			}
			const insertion = tokenEnd > 0 ? costs[columnEnd][tokenEnd - 1] + gapCost : Infinity;
			if (insertion < best) {
				best = insertion;
				step = -1;
			}
			costs[columnEnd][tokenEnd] = best;
			steps[columnEnd][tokenEnd] = step;
		}
	}

	const placed: AlignmentColumn[] = [];
	const insertedColumnIds: string[] = [];
	let columnEnd = columns.length;
	let tokenEnd = tokens.length;
	while (columnEnd > 0 || tokenEnd > 0) {
		const step = steps[columnEnd][tokenEnd];
		if (step === -1) {
			const cells = new Map(
				options.witnessOrder
					.filter(id => id !== witness.id)
					.map(id => [
						id,
						insertionAbsence(
							columns[columnEnd - 1]?.cells.get(id),
							columns[columnEnd]?.cells.get(id)
						),
					])
			);
			cells.set(witness.id, alignmentCellFromTokens(tokens.slice(tokenEnd - 1, tokenEnd)));
			const id = makeId();
			placed.push({ id, index: 0, cells, merged: false });
			insertedColumnIds.push(id);
			tokenEnd--;
		} else {
			const column = columns[columnEnd - 1];
			const cells = new Map(column.cells);
			cells.set(witness.id, alignmentCellFromTokens(tokens.slice(tokenEnd - step, tokenEnd)));
			placed.push({ ...column, cells });
			columnEnd--;
			tokenEnd -= step;
		}
	}
	return {
		columns: placed.reverse().map((column, index) => ({ ...column, index })),
		insertedColumnIds: insertedColumnIds.reverse(),
	};
}
