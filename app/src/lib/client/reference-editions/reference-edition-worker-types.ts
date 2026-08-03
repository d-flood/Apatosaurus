import type { ParsedReferenceEdition } from '$lib/reference-editions/source';

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
	  }
	| {
			type: 'error';
			requestId: number;
			error: string;
	  };
