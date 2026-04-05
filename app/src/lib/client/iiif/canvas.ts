import type { CanvasRef } from './types';

function firstValue(value: unknown): string | null {
	if (typeof value === 'string' && value.length > 0) return value;
	if (Array.isArray(value)) {
		for (const entry of value) {
			const nested = firstValue(entry);
			if (nested) return nested;
		}
		return null;
	}
	if (value && typeof value === 'object') {
		const candidate = value as Record<string, unknown>;
		return firstValue(candidate.value) || firstValue(candidate['@value']) || firstValue(candidate.none);
	}
	return null;
}

export function getCanvasLabel(canvas: any, index: number): string {
	try {
		if (typeof canvas?.getLabel === 'function') {
			const label = canvas.getLabel();
			return firstValue(label) || `Canvas ${index + 1}`;
		}
	} catch {
		// ignore malformed labels
	}
	return firstValue(canvas?.label) || `Canvas ${index + 1}`;
}

export function getCanvasThumbnailUrl(canvas: any, size = 220): string | null {
	try {
		if (typeof canvas?.getThumbnail === 'function') {
			const thumbnail = canvas.getThumbnail();
			if (typeof thumbnail === 'string') return thumbnail;
			if (thumbnail && typeof thumbnail === 'object') {
				return String((thumbnail as Record<string, unknown>).id || (thumbnail as Record<string, unknown>)['@id'] || '') || null;
			}
		}
	} catch {
		// ignore
	}

	const serviceUrl = getCanvasImageServiceUrl(canvas);
	if (serviceUrl) {
		return `${serviceUrl}/full/${size},/0/default.jpg`;
	}

	const resourceId = getCanvasImageResourceId(canvas);
	return resourceId || null;
}

export function getCanvasImageServiceUrl(canvas: any): string | null {
	const resource = getPrimaryCanvasResource(canvas);
	if (!resource) return null;

	const serviceCandidates =
		(typeof resource?.getServices === 'function' ? resource.getServices() : null) ||
		(resource?.__jsonld?.service
			? Array.isArray(resource.__jsonld.service)
				? resource.__jsonld.service
				: [resource.__jsonld.service]
			: Array.isArray(resource?.service)
				? resource.service
				: resource?.service
					? [resource.service]
					: []);

	for (const service of serviceCandidates) {
		const id = service?.id || service?.['@id'];
		if (typeof id === 'string' && id.length > 0) {
			return id;
		}
	}

	return null;
}

export function canvasToRef(canvas: any, index: number, manifestId: string): CanvasRef {
	return {
		manifestId,
		canvasId: String(canvas?.id || canvas?.['@id'] || canvas?.getCanvasId?.() || ''),
		canvasLabel: getCanvasLabel(canvas, index),
		canvasOrder: index + 1,
		imageServiceUrl: getCanvasImageServiceUrl(canvas),
		thumbnailUrl: getCanvasThumbnailUrl(canvas),
	};
}

function getPrimaryCanvasResource(canvas: any): any | null {
	try {
		let images = (typeof canvas?.getImages === 'function' ? canvas.getImages() : null) || [];
		if ((!images || images.length === 0) && typeof canvas?.getContent === 'function') {
			images = canvas.getContent() || [];
		}
		const annotation = images?.[0];
		if (!annotation) return null;

		if (typeof annotation.getResource === 'function') {
			const resource = annotation.getResource();
			if (resource) return resource;
		}

		if (typeof annotation.getBody === 'function') {
			const body = annotation.getBody();
			if (Array.isArray(body)) return body[0] || null;
			if (body && typeof body === 'object') {
				if (body.type === 'Choice' || body.type === 'oa:Choice') {
					const items = body.items || body.item || [];
					return Array.isArray(items) ? items[0] || null : items || null;
				}
				return body;
			}
		}

		const rawBody = annotation?.__jsonld?.body || annotation?.body;
		if (Array.isArray(rawBody)) return rawBody[0] || null;
		if (rawBody && typeof rawBody === 'object') {
			if (rawBody.type === 'Choice' || rawBody.type === 'oa:Choice') {
				const items = rawBody.items || rawBody.item || [];
				return Array.isArray(items) ? items[0] || null : items || null;
			}
			return rawBody;
		}
	} catch {
		return null;
	}

	return null;
}

function getCanvasImageResourceId(canvas: any): string | null {
	const resource = getPrimaryCanvasResource(canvas);
	if (!resource) return null;
	const id = resource.id || resource['@id'] || resource?.__jsonld?.id || resource?.__jsonld?.['@id'];
	return typeof id === 'string' && id.length > 0 ? id : null;
}
