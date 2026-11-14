import timeline from '../public/timeline.json';

export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const INTRO = 3.6;
export const OUTRO = 5.5;

type At = [string, number];
const m = (name: string, offset = 0): At => [name, offset];
export const at = ([name, offset]: At): number => {
	const t = (timeline.marks as Record<string, number>)[name];
	if (t === undefined) throw new Error(`Unknown mark ${name}`);
	return t + offset;
};

const CLIPS: { from: At; to: At; speed: number }[] = [
	{ from: m('setup-loaded', -0.2), to: m('pick-verse', 1.4), speed: 1.3 },
	{ from: m('witnesses-loaded', -0.3), to: m('pick-base'), speed: 1.4 },
	{ from: m('pick-base'), to: m('settings'), speed: 1.45 },
	{ from: m('settings'), to: m('proceed', 0.5), speed: 1.6 },
	{ from: m('alignment', -0.2), to: m('to-readings'), speed: 1.3 },
	{ from: m('to-readings'), to: m('attach-open'), speed: 1.4 },
	{ from: m('attach-open'), to: m('to-stemma'), speed: 1.25 },
	{ from: m('to-stemma'), to: m('stemma-5', 4.2), speed: 1.3 },
	{ from: m('stemma-5', 4.2), to: m('stemma-2'), speed: 6 },
	{ from: m('stemma-2'), to: m('to-review'), speed: 1.6 },
	{ from: m('to-review'), to: m('scroll-stemmata'), speed: 1.2 },
	{ from: m('scroll-stemmata'), to: m('end', 0.5), speed: 1.1 },
];

export const clips = CLIPS.map(c => {
	const from = at(c.from);
	const to = at(c.to);
	return { from, to, speed: c.speed, frames: Math.round(((to - from) * FPS) / c.speed) };
});

export const totalFrames =
	Math.round(INTRO * FPS) + clips.reduce((n, c) => n + c.frames, 0) + Math.round(OUTRO * FPS);

export type Focus = [number, number] | 'cursor';
const KEYS: { t: At; scale: number; focus: Focus; dur?: number }[] = [
	{ t: m('setup-loaded', -1), scale: 1, focus: [960, 540] },
	{ t: m('setup-loaded', 0.4), scale: 1.35, focus: 'cursor', dur: 1.4 },
	{ t: m('witnesses-loaded', -0.3), scale: 1, focus: [960, 540], dur: 0.01 },
	{ t: m('exclude-correctors', -0.2), scale: 1.25, focus: 'cursor', dur: 1.4 },
	{ t: m('settings', -0.3), scale: 1.2, focus: 'cursor', dur: 1.2 },
	{ t: m('alignment', -0.3), scale: 1, focus: [960, 540], dur: 0.01 },
	{ t: m('alignment', 0.6), scale: 1.2, focus: [900, 400], dur: 1.6 },
	{ t: m('vu-view', 0.2), scale: 1.15, focus: [760, 420], dur: 1.2 },
	{ t: m('to-readings', 0.5), scale: 1, focus: [960, 540], dur: 1 },
	{ t: m('readings', 0.8), scale: 1.3, focus: 'cursor', dur: 1.4 },
	{ t: m('attached', 0.1), scale: 1.5, focus: [560, 300], dur: 1.2 },
	{ t: m('otheos-unit', 0.5), scale: 1.35, focus: [700, 380], dur: 1.2 },
	{ t: m('to-stemma', 0.6), scale: 1, focus: [960, 540], dur: 1 },
	{ t: m('stemma', 0.5), scale: 1.4, focus: 'cursor', dur: 1.4 },
	{ t: m('to-review', 0.3), scale: 1, focus: [960, 540], dur: 1 },
	{ t: m('review', 0.6), scale: 1.25, focus: [800, 520], dur: 1.4 },
	{ t: m('scroll-stemmata', 0), scale: 1, focus: [960, 540], dur: 1 },
	{ t: m('stemmata', 0.6), scale: 1.3, focus: 'cursor', dur: 1.6 },
];
export const cameraKeys = KEYS.map(k => ({
	t: at(k.t),
	scale: k.scale,
	focus: k.focus,
	dur: k.dur ?? 1.2,
}));

export type CaptionPos = 'bl' | 'br' | 'tr';
const CAPTIONS: { from: At; to: At; step: string; title: string; line: string; pos: CaptionPos }[] =
	[
		{
			from: m('setup-loaded', 0.2),
			to: m('pick-verse', 1.4),
			step: '1',
			title: 'Setup · choose the passage',
			line: 'Filter the verse index and pick Rom 8:28.',
			pos: 'br',
		},
		{
			from: m('witnesses-loaded', -0.3),
			to: m('name-segment'),
			step: '1',
			title: 'Setup · witnesses and base text',
			line: 'Every project transcription covering the verse loads. Hide the two corrector hands; cite variants against 01.',
			pos: 'bl',
		},
		{
			from: m('name-segment'),
			to: m('proceed', 0.5),
			step: '1',
			title: 'Setup · segment and settings',
			line: 'Name the collation segment. Collation settings live with the project: punctuation, word breaks, regularization rules.',
			pos: 'br',
		},
		{
			from: m('alignment', -0.2),
			to: m('to-readings'),
			step: '2',
			title: 'Alignment',
			line: 'CollateX aligns the witnesses; dots mark variation units. 10046 20002 20003 (P46 A B) add ὁ θεός.',
			pos: 'bl',
		},
		{
			from: m('to-readings'),
			to: m('otheos-unit'),
			step: '3',
			title: 'Readings',
			line: 'Classify readings: 1881’s οιδαμε becomes an orthographic subreading of a (ao).',
			pos: 'bl',
		},
		{
			from: m('otheos-unit'),
			to: m('to-stemma'),
			step: '3',
			title: 'Readings · ὁ θεός',
			line: 'The lemma a is the omission, as in 01; b adds ὁ θεός.',
			pos: 'bl',
		},
		{
			from: m('stemma', -0.4),
			to: m('to-review'),
			step: '4',
			title: 'Local stemma',
			line: 'Drag a reading onto its source. Here ὁ θεός, γάρ and πᾶν each derive from a.',
			pos: 'br',
		},
		{
			from: m('to-review'),
			to: m('end', 0.5),
			step: '5',
			title: 'Review',
			line: 'The verse apparatus and a local stemma for every variation unit, ready for TEI export.',
			pos: 'br',
		},
	];
export const captions = CAPTIONS.map(c => ({ ...c, from: at(c.from), to: at(c.to) }));

export const events = timeline.events as {
	t: number;
	type: 'move' | 'down' | 'up';
	x: number;
	y: number;
}[];
