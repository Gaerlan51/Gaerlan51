import { StyleSheet } from '@react-pdf/renderer';

export const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.5 },
  letterhead: { borderBottom: '2 solid #0f766e', paddingBottom: 10, marginBottom: 18 },
  clinicName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#0f766e' },
  clinicMeta: { fontSize: 9, color: '#4b5563', marginTop: 2 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  label: { fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 11, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 24, marginBottom: 6 },
  col: { flexGrow: 1, flexBasis: 0 },
  body: { marginTop: 12, marginBottom: 24 },
  item: { marginBottom: 8, paddingBottom: 8, borderBottom: '0.5 solid #e5e7eb' },
  itemName: { fontFamily: 'Helvetica-Bold' },
  itemMeta: { fontSize: 9, color: '#4b5563' },
  signature: { marginTop: 36, borderTop: '1 solid #111827', width: 240, paddingTop: 6 },
  footer: {
    position: 'absolute', bottom: 28, left: 48, right: 48,
    fontSize: 8, color: '#6b7280', borderTop: '0.5 solid #e5e7eb', paddingTop: 6,
  },
  watermark: {
    position: 'absolute', top: '45%', left: '-5%', width: '110%',
    textAlign: 'center', fontSize: 34, fontFamily: 'Helvetica-Bold',
    color: '#dc2626', opacity: 0.22, transform: 'rotate(-24deg)',
  },
});

export const DRAFT_WATERMARK = 'DRAFT — NOT VALID FOR DISPENSING';

/**
 * Spec §9: anything not signed prints watermarked. Voided documents are
 * watermarked too — a voided prescription is emphatically not dispensable.
 */
export function shouldWatermark(status: string): boolean {
  return status !== 'signed';
}
