const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/**
 * How long ago `fromIso` was, in plain words: "just now", "12 minutes ago", "3 hours ago",
 * "yesterday", "3 days ago" or "2 weeks ago". A time a little ahead of `now` (another
 * device's clock) reads as "just now".
 */
export function formatAge(fromIso: string, now: Date): string {
	const then = Date.parse(fromIso);
	if (Number.isNaN(then)) return 'at an unknown time';
	const ms = now.getTime() - then;
	if (ms < MINUTE) return 'just now';
	if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute');
	if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour');
	if (ms < 2 * DAY) return 'yesterday';
	if (ms < 14 * DAY) return plural(Math.floor(ms / DAY), 'day');
	return plural(Math.floor(ms / (7 * DAY)), 'week');
}
