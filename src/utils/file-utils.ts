import browser from './browser-polyfill';
import { detectBrowser } from './browser-detection';

export interface SaveFileOptions {
	content: string;
	fileName: string;
	mimeType?: string;
	tabId?: number;
	onError?: (error: Error) => void;
	directory?: string;
}

export function base64EncodeUnicode(str: string): string {
	const utf8Bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, 
		(match, p1) => String.fromCharCode(parseInt(p1, 16))
	);
	return btoa(utf8Bytes);
}

export async function saveFile({
	content,
	fileName,
	mimeType = 'text/markdown',
	tabId,
	onError,
	directory
}: SaveFileOptions): Promise<void> {
	try {
		if (mimeType === 'text/markdown' && !fileName.toLowerCase().endsWith('.md')) {
			fileName = `${fileName}.md`;
		}

		const browserType = await detectBrowser();
		const isSafari = ['ios', 'mobile-ios', 'ipad-os', 'safari', 'mobile-safari'].includes(browserType);

		// Use downloads API if a custom directory is specified and we're not on Safari
		if (directory && !isSafari) {
			try {
				console.log('[Clipper] Download directory:', directory, 'Filename:', fileName);
				// Create a data URI from the content
				const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;

				// Sanitize the directory path - remove leading/trailing slashes and backslashes
				let cleanDirectory = directory.replace(/^[\\\/]+/, '').replace(/[\\\/]+$/, '');
				console.log('[Clipper] Clean directory:', cleanDirectory);

				// Construct the full path with directory
				const fullPath = cleanDirectory ? `${cleanDirectory}/${fileName}` : fileName;
				console.log('[Clipper] Full download path:', fullPath);

				// Send message to background script to handle the download
				// This ensures the download continues even if the popup closes
				const response = await browser.runtime.sendMessage({
					action: 'downloadFile',
					url: dataUrl,
					filename: fullPath
				}) as { success?: boolean; error?: string; downloadId?: number };

				if (!response || !response.success) {
					throw new Error(response?.error || 'Download failed');
				}

				return;
			} catch (downloadError) {
				console.error('Downloads API failed, falling back to default download:', downloadError);
				// Fall through to default download behavior
			}
		}

		if (isSafari) {
			const blob = new Blob([content], { type: 'application/json' });
			const file = new File([blob], fileName, { type: 'application/json' });
			const dataUri = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;

			// Use share API if there is no tab ID, e.g. in settings pages
			if (!tabId) {
				if (navigator.share) {
					try {
						await navigator.share({
							files: [file],
							text: fileName
						});
					} catch (error) {
						console.error('Error sharing:', error);
						// Fallback to opening in a new tab if sharing fails
						window.open(dataUri);
					}
				} else {
					// Fallback for older iOS versions
					window.open(dataUri);
				}
				throw new Error('Tab ID is required for saving files in Safari');
			}

			await browser.scripting.executeScript({
				target: { tabId },
				func: (fileName: string, dataUri: string) => {
					const a = document.createElement('a');
					a.href = dataUri;
					a.download = fileName;
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
				},
				args: [fileName, dataUri]
			});
		} else {
			const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = fileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}
	} catch (error) {
		console.error('Failed to save file:', error);
		if (onError) {
			onError(error as Error);
		}
	}
} 