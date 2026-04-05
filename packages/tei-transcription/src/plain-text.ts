import type {
	CorrectionReading,
	InlineItem,
	LineItem,
	PlainTextOptions,
	TeiMetadata,
	TextItem,
	TranscriptionDocument,
} from './types';

export function serializePlainText(
	document: TranscriptionDocument,
	options: PlainTextOptions = {},
	metadata?: TeiMetadata
): string {
	const includeHeader = options.includeHeader ?? false;
	const includePageBreaks = options.includePageBreaks ?? true;
	const includeLineNumbers = options.includeLineNumbers ?? false;
	const lines: string[] = [];

	if (includeHeader) {
		if (metadata?.title) lines.push(`# ${metadata.title}`);
		if (metadata?.transcriber) lines.push(`## ${metadata.transcriber}`);
		if (metadata?.date) lines.push(`### ${metadata.date}`);
		if (lines.length > 0) lines.push('');
	}

	for (const page of document.pages) {
		if (includePageBreaks) {
			lines.push(`<pb n="${page.id}"/>`);
		}

		for (const column of page.columns) {
			for (const line of column.lines) {
				const prefix = includeLineNumbers ? `${line.number}. ` : '';
				lines.push(`${prefix}${serializeLineItems(line.items).trimEnd()}`);
			}
		}
	}

	return lines.join('\n');
}

function serializeLineItems(items: LineItem[]): string {
	return items
		.map(item => {
			switch (item.type) {
				case 'text':
					return serializeText(item);
				case 'boundary':
					return ' ';
				case 'milestone':
					if (item.kind === 'book') return `<book:${item.attrs.book || ''}>`;
					if (item.kind === 'chapter') return `<chapter:${item.attrs.chapter || ''}>`;
					return `<verse:${item.attrs.verse || ''}>`;
				case 'teiMilestone':
					return `<milestone${serializeAttrs(item.attrs)}/>`;
				case 'gap':
					return `<gap${serializeAttrs(item.attrs)}/>`;
				case 'space':
					return `<space${serializeAttrs(item.attrs)}/>`;
				case 'handShift':
					return `<handShift${serializeAttrs(item.attrs)}/>`;
				case 'metamark':
					return `<metamark:${item.summary}>`;
				case 'teiAtom':
					return `<${item.tag}:${item.summary}>`;
				case 'teiWrapper':
					return `<${item.tag}:${item.summary}>`;
				case 'editorialAction':
					return `<${item.tag}:${item.summary}>`;
				case 'untranscribed':
					return `{${item.attrs.reason || 'Untranscribed'}}`;
				case 'correctionOnly':
					return item.corrections.map(serializeCorrectionReading).join(' ');
				case 'fw':
					return `<fw:${serializeInlineItems(item.content).trim()}>`;
			}
		})
		.join('');
}

function serializeText(item: TextItem): string {
	let output = item.text;
	for (const mark of item.marks || []) {
		switch (mark.type) {
			case 'lacunose':
				output = `[${output}]`;
				break;
			case 'unclear':
				output = `\`${output}\``;
				break;
			case 'abbreviation':
				if (mark.attrs.type === 'ligature') {
					output = `${output}{=${mark.attrs.expansion || ''}}`;
				} else if (mark.attrs.expansion) {
					output = `${output}{abbr=${mark.attrs.expansion}}`;
				}
				break;
			case 'word':
				break;
			case 'hi':
				output = `{hi:${output}}`;
				break;
			case 'damage':
				output = `{damage:${output}}`;
				break;
			case 'surplus':
				output = `{surplus:${output}}`;
				break;
			case 'secl':
				output = `{secl:${output}}`;
				break;
			case 'teiSpan':
				if (mark.attrs.tag === 'mod' || mark.attrs.tag === 'retrace') {
					output = `{${mark.attrs.tag}:${output}}`;
				}
				break;
			case 'punctuation':
				break;
			case 'correction':
				output = serializeCorrection(output, mark.attrs.corrections);
				break;
		}
	}
	return output;
}

function serializeCorrection(original: string, corrections: CorrectionReading[]): string {
	const correctionText = corrections
		.map(correction => `${correction.hand}: ${serializeInlineItems(correction.content).trim()}`)
		.join(' | ');
	return `++ ${original} => ${correctionText} ++`;
}

function serializeCorrectionReading(correction: CorrectionReading): string {
	return `++ ${correction.hand}: ${serializeInlineItems(correction.content).trim()} ++`;
}

function serializeInlineItems(items: InlineItem[]): string {
	return items
		.map(item => {
			if (item.type === 'boundary') return ' ';
			if (item.type === 'pageBreak') return '<pb/>';
			if (item.type === 'lineBreak') return '<lb/>';
			if (item.type === 'columnBreak') return '<cb/>';
			if (item.type === 'gap') return `<gap${serializeAttrs(item.attrs)}/>`;
			if (item.type === 'space') return `<space${serializeAttrs(item.attrs)}/>`;
			if (item.type === 'handShift') return `<handShift${serializeAttrs(item.attrs)}/>`;
			if (item.type === 'metamark') return `<metamark:${item.summary}>`;
			if (item.type === 'teiAtom') return `<${item.tag}:${item.summary}>`;
			if (item.type === 'teiWrapper') return `<${item.tag}:${item.summary}>`;
			if (item.type === 'teiMilestone') return `<milestone${serializeAttrs(item.attrs)}/>`;
			if (item.type === 'fw') return `<fw:${serializeInlineItems(item.content).trim()}>`;
			if (item.type === 'correctionOnly') {
				return item.corrections.map(serializeCorrectionReading).join(' ');
			}
			return serializeText(item);
		})
		.join('');
}

function serializeAttrs(attrs: Record<string, string | undefined>): string {
	const pairs = Object.entries(attrs).filter(([, value]) => value);
	if (pairs.length === 0) return '';
	return (
		' ' +
		pairs
			.map(([key, value]) => `${key}="${String(value)}"`)
			.join(' ')
	);
}
