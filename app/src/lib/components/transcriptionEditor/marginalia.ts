import type { MarginaliaCategory } from './formworkConcepts';
import { buildMarginaliaDocFromText } from './formworkContent';

export const MARGINALIA_CATEGORIES: Exclude<MarginaliaCategory, null>[] = [
	'Marginal',
	'Interlinear',
	'Column',
	'Inline',
	'Other',
];

export const MARGINALIA_PLACEMENTS: Record<
	Exclude<MarginaliaCategory, null>,
	Array<{ value: string; label: string }>
> = {
	Marginal: [
		{ value: 'lineLeft', label: 'Left Margin' },
		{ value: 'lineRight', label: 'Right Margin' },
		{ value: 'margin', label: 'General Margin' },
	],
	Interlinear: [
		{ value: 'lineAbove', label: 'Above Line' },
		{ value: 'lineBelow', label: 'Below Line' },
	],
	Column: [
		{ value: 'columnTop', label: 'Column Top' },
		{ value: 'columnBottom', label: 'Column Bottom' },
	],
	Inline: [
		{ value: 'inline', label: 'Inline' },
		{ value: 'inSpace', label: 'Reserved Space' },
	],
	Other: [
		{ value: 'unknown', label: 'Unspecified' },
		{ value: 'oppositePage', label: 'Opposite Page' },
		{ value: 'overleaf', label: 'Overleaf' },
		{ value: 'pageEnd', label: 'At End' },
	],
};

export function createDefaultMarginaliaAttrs(
	category: MarginaliaCategory,
	content: string | Array<Record<string, any>>
): Record<string, any> {
	const marginaliaId =
		typeof crypto?.randomUUID === 'function'
			? `marginalia-${crypto.randomUUID()}`
			: `marginalia-${Math.random().toString(36).slice(2, 12)}`;
	const normalizedCategory = category || 'Other';
	const base = {
		marginaliaId,
		type: '',
		subtype: '',
		place: '',
		rend: '',
		segType: '',
		segSubtype: '',
		segPlace: '',
		content:
			typeof content === 'string'
				? buildMarginaliaDocFromText(content)
				: JSON.parse(JSON.stringify(content || [])),
	};

	return {
		...base,
		...marginaliaPlacementPreset(
			normalizedCategory,
			defaultPlacementForCategory(normalizedCategory)
		),
	};
}

export function defaultPlacementForCategory(
	category: Exclude<MarginaliaCategory, null>
): string {
	switch (category) {
		case 'Marginal':
			return 'lineRight';
		case 'Interlinear':
			return 'lineAbove';
		case 'Column':
			return 'columnTop';
		case 'Inline':
			return 'inline';
		case 'Other':
		default:
			return 'unknown';
	}
}

export function marginaliaPlacementPreset(
	category: MarginaliaCategory,
	placement: string
): Record<string, any> {
	switch (placement) {
		case 'lineLeft':
			return { place: 'margin left', segType: 'margin', segSubtype: 'lineleft', segPlace: 'margin left' };
		case 'lineRight':
			return { place: 'margin right', segType: 'margin', segSubtype: 'lineright', segPlace: 'margin right' };
		case 'margin':
			return { place: 'margin', segType: 'margin', segSubtype: '', segPlace: 'margin' };
		case 'lineAbove':
			return { place: 'above', segType: 'line', segSubtype: 'above', segPlace: 'above' };
		case 'lineBelow':
			return { place: 'below', segType: 'line', segSubtype: 'below', segPlace: 'below' };
		case 'columnTop':
			return { place: 'top', segType: 'margin', segSubtype: 'coltop', segPlace: 'top' };
		case 'columnBottom':
			return { place: 'bottom', segType: 'margin', segSubtype: 'colbottom', segPlace: 'bottom' };
		case 'inline':
			return { place: 'inline', segType: '', segSubtype: '', segPlace: 'inline' };
		case 'inSpace':
			return { place: 'inspace', segType: '', segSubtype: '', segPlace: 'inspace' };
		case 'oppositePage':
			return { place: 'opposite', segType: '', segSubtype: '', segPlace: 'opposite' };
		case 'overleaf':
			return { place: 'overleaf', segType: '', segSubtype: '', segPlace: 'overleaf' };
		case 'pageEnd':
			return { place: 'end', segType: '', segSubtype: '', segPlace: 'end' };
		case 'unknown':
		default:
			return category === 'Other'
				? { place: '', segType: '', segSubtype: '', segPlace: '' }
				: {};
	}
}
