type DomSpecChild = [string, Record<string, string | number>, ...DomSpecChild[]];

export type BadgeIconName =
	| 'blankSpace'
	| 'column'
	| 'columnBreak'
	| 'correctionNode'
	| 'handShift'
	| 'inline'
	| 'interlinear'
	| 'lacuna'
	| 'lineBreak'
	| 'marginal'
	| 'metamark'
	| 'milestone'
	| 'pageBreak'
	| 'pageFurniture'
	| 'note'
	| 'teiAtom'
	| 'teiWrapper'
	| 'untranscribed';

function iconAttrs(size: number): Record<string, string | number> {
	return {
		xmlns: 'http://www.w3.org/2000/svg',
		viewBox: '0 0 256 256',
		width: size,
		height: size,
		fill: 'none',
		stroke: 'currentColor',
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
		'stroke-width': 16,
		'aria-hidden': 'true',
		class: 'tei-inline-badge-icon',
	};
}

function svg(size: number, ...children: DomSpecChild[]): DomSpecChild {
	return ['svg', iconAttrs(size), ...children];
}

function path(d: string): DomSpecChild {
	return ['path', { d }];
}

function line(x1: number, y1: number, x2: number, y2: number): DomSpecChild {
	return ['line', { x1, y1, x2, y2 }];
}

function rect(x: number, y: number, width: number, height: number, rx: number, extra = {}): DomSpecChild {
	return ['rect', { x, y, width, height, rx, ...extra }];
}

function circle(cx: number, cy: number, r: number, extra = {}): DomSpecChild {
	return ['circle', { cx, cy, r, ...extra }];
}

export function badgeIconSpec(name: BadgeIconName, size: number = 14): DomSpecChild {
	switch (name) {
		case 'blankSpace':
			return svg(
				size,
				path('M40,128V184a8,8,0,0,0,8,8H208a8,8,0,0,0,8-8V128'),
				['line', { x1: 40, y1: 144, x2: 216, y2: 144, 'stroke-dasharray': '24 12' }]
			);
		case 'column':
			return svg(
				size,
				['rect', { x: 32, y: 48, width: 80, height: 160, rx: 8, 'stroke-dasharray': '24 12' }],
				rect(144, 48, 80, 160, 8),
				line(160, 88, 208, 88),
				line(160, 128, 208, 128),
				line(160, 168, 208, 168)
			);
		case 'columnBreak':
			return svg(
				size,
				line(200, 40, 200, 216),
				line(160, 40, 160, 216),
				path('M120,128H40a16,16,0,0,0-16,16v56'),
				path('M96,104l24,24l-24,24')
			);
		case 'correctionNode':
			return svg(
				size,
				path('M64,200l64-100l64,100'),
				line(128, 40, 128, 80),
				line(108, 60, 148, 60)
			);
		case 'handShift':
			return svg(
				size,
				path('M216,40,168,88c-12-12-32-12-44,0l-84,84c-12,12-12,32,0,44s32,12,44,0l84-84C180,120,180,100,168,88L216,40Z'),
				line(40, 216, 64, 192),
				path('M128,128c8,8,16,16,24,24')
			);
		case 'inline':
			return svg(
				size,
				['rect', { x: 40, y: 40, width: 176, height: 176, rx: 16, 'stroke-dasharray': '24 12' }],
				rect(88, 104, 80, 48, 4)
			);
		case 'interlinear':
			return svg(
				size,
				['line', { x1: 40, y1: 64, x2: 216, y2: 64, 'stroke-dasharray': '24 12' }],
				['line', { x1: 40, y1: 192, x2: 216, y2: 192, 'stroke-dasharray': '24 12' }],
				line(64, 128, 192, 128),
				path('M128,104l0,24'),
				path('M116,116l12-12l12,12')
			);
		case 'lacuna':
			return svg(
				size,
				path('M216,216H40V48H72l16-16,16,16,16-16,16,16,16-16,16,16,16-16,16,16h24V216'),
				line(88, 104, 168, 104),
				line(88, 144, 168, 144)
			);
		case 'lineBreak':
			return svg(size, path('M200,56v80a16,16,0,0,1-16,16H56'), path('M88,120L56,152l32,32'));
		case 'marginal':
			return svg(
				size,
				['rect', { x: 96, y: 48, width: 120, height: 160, rx: 8, 'stroke-dasharray': '24 12' }],
				rect(32, 80, 48, 96, 4)
			);
		case 'metamark':
			return svg(
				size,
				line(48, 128, 208, 128),
				line(128, 48, 128, 208),
				circle(88, 88, 8, { fill: 'currentColor', stroke: 'none' }),
				circle(168, 88, 8, { fill: 'currentColor', stroke: 'none' }),
				circle(88, 168, 8, { fill: 'currentColor', stroke: 'none' }),
				circle(168, 168, 8, { fill: 'currentColor', stroke: 'none' })
			);
		case 'milestone':
			return svg(
				size,
				line(128, 40, 128, 216),
				circle(128, 128, 32),
				line(96, 40, 160, 40),
				line(96, 216, 160, 216)
			);
		case 'pageBreak':
			return svg(
				size,
				rect(56, 40, 96, 176, 8),
				path('M152,40h24l24,24v152H152'),
				line(112, 72, 112, 184),
				path('M96,120l16-16l16,16'),
				path('M96,144l16,16l16-16')
			);
		case 'pageFurniture':
			return svg(
				size,
				path('M128,216v-80'),
				path('M128,136c0-40,40-80,80-80s-40,80-80,80'),
				path('M128,136c0-40-40-80-80-80s40,80,80,80'),
				path('M128,136c0,40,40,80,80,80s-40-80-80-80'),
				path('M128,136c0,40-40,80-80,80s40-80,80-80')
			);
		case 'note':
			return svg(size, [
				'path',
				{
					d: 'M88,96a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H96A8,8,0,0,1,88,96Zm8,40h64a8,8,0,0,0,0-16H96a8,8,0,0,0,0,16Zm32,16H96a8,8,0,0,0,0,16h32a8,8,0,0,0,0-16ZM224,48V156.69A15.86,15.86,0,0,1,219.31,168L168,219.31A15.86,15.86,0,0,1,156.69,224H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM48,208H152V160a8,8,0,0,1,8-8h48V48H48Zm120-40v28.7L196.69,168Z',
					fill: 'currentColor',
					stroke: 'none',
				},
			]);
		case 'teiAtom':
			return svg(
				size,
				circle(128, 128, 80),
				circle(128, 128, 8, { fill: 'currentColor', stroke: 'none' })
			);
		case 'teiWrapper':
			return svg(
				size,
				path('M72,40H40V216H72'),
				path('M184,40h32V216H184'),
				circle(128, 128, 8, { fill: 'currentColor', stroke: 'none' })
			);
		case 'untranscribed':
			return svg(size, rect(40, 40, 176, 176, 16), path('M160,152a32,32,0,0,1-64,0V96'));
	}
}
