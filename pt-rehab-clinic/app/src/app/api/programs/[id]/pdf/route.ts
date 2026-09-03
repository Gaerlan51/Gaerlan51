import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { getProgramForPrint } from '@/server/programs';
import { ProgramPdf } from '@/pdf/ProgramPdf';
import type { ProgramItem } from '@/server/programs';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const program = await getProgramForPrint(id);
  if (!program) return new Response('Not found', { status: 404 });

  const bodyRow = Array.isArray(program.program_body) ? program.program_body[0] : program.program_body;
  const items = ((bodyRow?.body as { items?: ProgramItem[] } | undefined)?.items ?? []);

  const buffer = await renderToBuffer(
    React.createElement(ProgramPdf, {
      title: program.title,
      discipline: program.discipline,
      status: program.status,
      items,
      patient: program.patients as never,
      clinic: program.clinics as never,
      signer: program.signer as never,
    }) as never,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="programme-${id.slice(0, 8)}.pdf"`,
      'cache-control': 'no-store',
    },
  });
}
