import { exportTableCsv, type Exportable } from '@/server/export';

export const dynamic = 'force-dynamic';

/** Spec §12 — data must always be able to leave, as CSV. */
export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  const { filename, csv } = await exportTableCsv(table as Exportable);

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
