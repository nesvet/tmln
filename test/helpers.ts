/**
 * Creates midnight timestamp for test dates.
 * Uses local timezone: new Date(year, month - 1, day).
 */
export function midnight(year: number, month: number, day: number): number {
	return new Date(year, month - 1, day).getTime();
}
