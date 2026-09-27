export function downloadZipArchive(fileName: string, bytes: Uint8Array): void {
	const blob = new Blob([bytes.slice().buffer], { type: 'application/zip' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = fileName;
	link.hidden = true;
	document.body.append(link);
	link.click();
	// Firefox and Safari may not start reading the blob until after the click task returns.
	setTimeout(() => {
		link.remove();
		URL.revokeObjectURL(url);
	}, 0);
}
