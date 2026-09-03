import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDocumentForPrint } from '@/server/documents';
import { DocumentPdf } from '@/pdf/DocumentPdf';

export const dynamic = 'force-dynamic';

/** Rendering is logged as a print — a disclosure event (spec §6). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocumentForPrint(id);
  if (!doc) return new Response('Not found', { status: 404 });

  const buffer = await renderToBuffer(
    React.createElement(DocumentPdf, {
      kind: doc.kind,
      title: doc.title,
      status: doc.status,
      body: doc.body as Record<string, unknown>,
      patient: doc.patients as never,
      clinic: doc.clinics as never,
      signer: doc.signer as never,
      signedAt: doc.signed_at,
      contentHash: doc.content_hash,
    }) as never,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${doc.kind}-${id.slice(0, 8)}.pdf"`,
      'cache-control': 'no-store',
    },
  });
}
