/** CSV export (spec §12) — plain RFC 4180, no proprietary format. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const cols = columns ?? Object.keys(rows[0]);
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => escape(r[c])).join(','))].join('\r\n');
}

export function csvFilename(entity: string, now = new Date()): string {
  return `${entity}-${now.toISOString().slice(0, 10)}.csv`;
}
