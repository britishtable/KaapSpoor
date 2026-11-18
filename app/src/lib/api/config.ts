/** Base URL of the KaapSpoor server, or null when this build has no accounts (e.g. GitHub Pages). */
export function apiBaseUrl(): string | null {
	const url = import.meta.env.VITE_API_BASE_URL;
	return typeof url === 'string' && url.trim() !== '' ? url.trim() : null;
}
