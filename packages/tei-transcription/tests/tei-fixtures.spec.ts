import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { parseTei, serializeTei } from '../src/index';
import { validateIgntpXsd } from '../../../test-support/validate-igntp-xsd';
import { readFixture } from './fixtures';

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') {
		(globalThis as any).DOMParser = DOMParser;
	}
	if (typeof globalThis.Node === 'undefined') {
		class TestNode {}
		Object.assign(TestNode, {
			ELEMENT_NODE: 1,
			TEXT_NODE: 3,
			CDATA_SECTION_NODE: 4,
			PROCESSING_INSTRUCTION_NODE: 7,
			COMMENT_NODE: 8,
			DOCUMENT_NODE: 9,
			DOCUMENT_TYPE_NODE: 10,
			DOCUMENT_FRAGMENT_NODE: 11,
		});
		(globalThis as any).Node = TestNode;
	}
});

const kitchenSinkFixtures = [
	'IGNTP_KITCHEN_SINK_body.xml',
	'IGNTP_KITCHEN_SINK_header_msdesc.xml',
	'IGNTP_KITCHEN_SINK_resources.xml',
	'IGNTP_KITCHEN_SINK_editorial.xml',
] as const;

const unsupportedFixtures = [
	'IGNTP_KITCHEN_SINK_apparatus.xml',
	'IGNTP_KITCHEN_SINK_master.xml',
] as const;

describe('IGNTP kitchen-sink fixtures', () => {
	it.each(kitchenSinkFixtures)('round-trips %s through parse and serialize with XSD validation', (name) => {
		const xml = readFixture(name);
		const exported = serializeTei(parseTei(xml));

		expect(exported).toContain('<TEI xmlns="http://www.tei-c.org/ns/1.0"');
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it.each(unsupportedFixtures)('rejects %s because it contains out-of-scope apparatus markup', (name) => {
		const xml = readFixture(name);
		expect(() => parseTei(xml)).toThrow(/out of scope|Only single-witness correction-style app\/rdg structures are supported/);
	});
});
