export type Period = 'week' | 'month' | 'custom';

/** Reporting window for the Owner Dashboard (spec §11). */
export function periodRange(period: Period, now = new Date()): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(now);
  if (period === 'week') from.setDate(from.getDate() - 7);
  else from.setMonth(from.getMonth() - 1);
  return { from, to };
}
