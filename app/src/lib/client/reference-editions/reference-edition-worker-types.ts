import type { ParsedReferenceEdition } from '$lib/reference-editions/source';

export interface ParsedReferenceEditionMetadata {
	title?: string;
	attribution?: string;
}

export interface ParsedReferenceEditionResult {
	source: ParsedReferenceEdition;
	metadata: ParsedReferenceEditionMetadata;
}

export type ReferenceEditionWorkerRequest = {
	type: 'parse';
	requestId: number;
	assetPath?: string;
	xml?: string;
};

export type ReferenceEditionWorkerResponse =
	| {
			type: 'parsed';
			requestId: number;
			source: ParsedReferenceEdition;
			metadata: ParsedReferenceEditionMetadata;
	  }
	| {
			type: 'error';
			requestId: number;
			error: string;
	  };
