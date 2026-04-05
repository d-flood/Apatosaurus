interface FormWorkNodeLike {
	type?: string;
	text?: string;
	content?: FormWorkNodeLike[];
	attrs?: Record<string, any>;
}

export function buildPlainTextFormWorkContent(text: string): Array<Record<string, any>> {
	const normalized = text.trim().replace(/\s+/g, ' ');
	if (!normalized) return [];

	const content: Array<Record<string, any>> = [];
	for (const part of normalized.split(/(\s+)/)) {
		if (!part) continue;
		content.push({ type: 'text', text: part });
	}
	return content;
}

export function buildMarginaliaDocFromText(text: string): Record<string, any> {
	return {
		type: 'doc',
		content: [
			{
				type: 'marginaliaColumn',
				attrs: { columnNumber: 1 },
				content: [
					{
						type: 'marginaliaLine',
						attrs: { lineNumber: 1 },
						content: buildPlainTextFormWorkContent(text),
					},
				],
			},
		],
	};
}

export function normalizeMarginaliaContent(content: unknown): Record<string, any> {
	if (isStructuredFormWorkContent(content)) {
		return JSON.parse(JSON.stringify(content));
	}

	if (Array.isArray(content)) {
		return {
			type: 'doc',
			content: [
				{
					type: 'marginaliaColumn',
					attrs: { columnNumber: 1 },
					content: [
						{
							type: 'marginaliaLine',
							attrs: { lineNumber: 1 },
							content: JSON.parse(JSON.stringify(content)),
						},
					],
				},
			],
		};
	}

	return buildMarginaliaDocFromText('');
}

export function isStructuredFormWorkContent(content: unknown): content is Record<string, any> {
	return !!content && typeof content === 'object' && (content as Record<string, any>).type === 'doc';
}

export function formWorkContentToPlainText(content: unknown): string {
	return collectText(content)
		.replace(/\s+/g, ' ')
		.trim();
}

function collectText(content: unknown): string {
	if (Array.isArray(content)) {
		return content.map(node => collectText(node)).join('');
	}

	if (!content || typeof content !== 'object') {
		return '';
	}

	const node = content as FormWorkNodeLike;
	if (node.type === 'text') {
		return String(node.text || '');
	}

	if (Array.isArray(node.content)) {
		const joiner = node.type === 'marginaliaLine' ? ' ' : '';
		return node.content.map(child => collectText(child)).join(joiner);
	}

	return '';
}
