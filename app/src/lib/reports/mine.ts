/**
 * The ids of reports each account filed, as known to THIS device: every report filed here, and
 * every held report the server has shown as theirs. The public list carries no author id (it
 * reads no token), so this is how a released report is still recognised as the reader's own.
 * A report filed on another device and released before this one ever saw it held is not known.
 */
const KEY = 'ks.reports.mine';

function read(): Record<string, string[]> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {};
	} catch {
		return {};
	}
}

export function mineIds(owner: string): Set<string> {
	const ids = read()[owner];
	return new Set(Array.isArray(ids) ? ids : []);
}

export function rememberMine(owner: string, id: string): void {
	const all = read();
	const ids = Array.isArray(all[owner]) ? all[owner] : [];
	if (ids.includes(id)) return;
	all[owner] = [...ids, id];
	try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* unavailable: the report reads as anyone's */ }
}
