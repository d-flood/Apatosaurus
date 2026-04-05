import type { TeiMsDescriptionInfo, TeiMsIdentifier } from './types';

export function generateTeiMsDescXml(
	msIdentifier: TeiMsIdentifier | undefined,
	msDescription: TeiMsDescriptionInfo | undefined,
	helpers: {
		escapeXml: (text: string) => string;
		serializeAttrs: (attrs: Record<string, string | undefined>) => string;
	}
): string {
	const { escapeXml, serializeAttrs } = helpers;
	const identifierXml = [
		'<msIdentifier>',
		msIdentifier?.country ? `<country>${escapeXml(msIdentifier.country)}</country>` : '',
		msIdentifier?.settlement ? `<settlement>${escapeXml(msIdentifier.settlement)}</settlement>` : '',
		msIdentifier?.repository ? `<repository>${escapeXml(msIdentifier.repository)}</repository>` : '',
		msIdentifier?.idno ? `<idno>${escapeXml(msIdentifier.idno)}</idno>` : '',
		msDescription?.msName ? `<msName>${escapeXml(msDescription.msName)}</msName>` : '',
		'</msIdentifier>',
	].join('');

	const contentsXml =
		msDescription?.contents && msDescription.contents.length > 0
			? [
				'<msContents>',
				...msDescription.contents.map(item =>
					[
						'<msItemStruct>',
						item.locus ? `<locus>${escapeXml(item.locus)}</locus>` : '',
						...(item.authors || []).map(author => `<author>${escapeXml(author)}</author>`),
						...(item.titles || []).map(title => `<title>${escapeXml(title)}</title>`),
						...(item.notes || []).map(note => `<note>${escapeXml(note)}</note>`),
						item.textLang ? `<textLang>${escapeXml(item.textLang)}</textLang>` : '',
						'</msItemStruct>',
					].join('')
				),
				'</msContents>',
			].join('')
			: '';

	const supportDescXml =
		msDescription?.material || msDescription?.foliation || msDescription?.condition
			? [
				`<supportDesc${serializeAttrs({ material: msDescription?.material })}>`,
				msDescription?.material ? `<support>${escapeXml(msDescription.material)}</support>` : '',
				msDescription?.foliation ? `<foliation>${escapeXml(msDescription.foliation)}</foliation>` : '',
				msDescription?.condition ? `<condition>${escapeXml(msDescription.condition)}</condition>` : '',
				'</supportDesc>',
			].join('')
			: '';

	const layoutDescXml =
		msDescription?.layouts && msDescription.layouts.length > 0
			? [
				'<layoutDesc>',
				...msDescription.layouts.map(layout =>
					`<layout${serializeAttrs({
						columns: layout.columns,
						writtenLines: layout.writtenLines,
					})}>${layout.text ? escapeXml(layout.text) : ''}</layout>`
				),
				'</layoutDesc>',
			].join('')
			: '';

	const objectDescXml =
		msDescription?.objectType || supportDescXml || layoutDescXml
			? [
				`<objectDesc${serializeAttrs({ form: msDescription?.objectType })}>`,
				supportDescXml,
				layoutDescXml,
				'</objectDesc>',
			].join('')
			: '';

	const handDescXml =
		msDescription?.hands && msDescription.hands.length > 0
			? [
				'<handDesc>',
				...msDescription.hands.map(hand => {
					const attrs = serializeAttrs(hand.attrs || {});
					return `<handNote${attrs}>${hand.text ? escapeXml(hand.text) : ''}</handNote>`;
				}),
				'</handDesc>',
			].join('')
			: '';

	const physDescXml =
		objectDescXml || handDescXml
			? ['<physDesc>', objectDescXml, handDescXml, '</physDesc>'].join('')
			: '';

	const historyXml =
		msDescription?.origDate ||
		msDescription?.origPlace ||
		(msDescription?.provenance && msDescription.provenance.length > 0)
			? [
				'<history>',
				msDescription?.origDate || msDescription?.origPlace
					? [
						'<origin>',
						msDescription?.origDate ? `<origDate>${escapeXml(msDescription.origDate)}</origDate>` : '',
						msDescription?.origPlace
							? `<origPlace>${escapeXml(msDescription.origPlace)}</origPlace>`
							: '',
						'</origin>',
					].join('')
					: '',
				...(msDescription?.provenance || []).map(
					provenance => `<provenance>${escapeXml(provenance)}</provenance>`
				),
				'</history>',
			].join('')
			: '';

	const additionalXml =
		msDescription?.surrogates && msDescription.surrogates.length > 0
			? [
				'<additional>',
				...msDescription.surrogates.map(
					surrogate => `<surrogates>${escapeXml(surrogate)}</surrogates>`
				),
				'</additional>',
			].join('')
			: '';

	return [
		'<msDesc>',
		identifierXml,
		contentsXml,
		physDescXml,
		historyXml,
		additionalXml,
		'</msDesc>',
	]
		.filter(Boolean)
		.join('');
}
