import React from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { styles, DRAFT_WATERMARK, shouldWatermark } from './theme';

export interface DocumentPdfProps {
  kind: 'referral_back' | 'referral_out' | 'prescription';
  title: string;
  status: 'draft' | 'signed' | 'voided';
  body: Record<string, unknown>;
  patient: { first_name: string; last_name: string; birth_date?: string | null; address?: string | null };
  clinic: { name: string; address?: string | null; phone?: string | null };
  signer?: { full_name: string; prc_license_no?: string | null } | null;
  signedAt?: string | null;
  contentHash?: string | null;
}

const KIND_LABEL: Record<DocumentPdfProps['kind'], string> = {
  referral_back: 'Referral Back to Referring Physician',
  referral_out: 'Referral to Other Facility',
  prescription: 'Prescription',
};

/**
 * Spec §9. An unsigned document carries the watermark on every page, and the
 * prescriber's PRC licence number appears only once a signature exists — a
 * printed draft must never be mistakable for a dispensable prescription.
 */
export function DocumentPdf(props: DocumentPdfProps) {
  const isDraft = shouldWatermark(props.status);
  const lines = String(props.body.text ?? '').split('\n').filter(Boolean);

  return (
    <Document title={props.title}>
      <Page size="A4" style={styles.page}>
        {isDraft && <Text style={styles.watermark} fixed>{DRAFT_WATERMARK}</Text>}

        <View style={styles.letterhead}>
          <Text style={styles.clinicName}>{props.clinic.name}</Text>
          {props.clinic.address ? <Text style={styles.clinicMeta}>{props.clinic.address}</Text> : null}
          {props.clinic.phone ? <Text style={styles.clinicMeta}>Tel: {props.clinic.phone}</Text> : null}
        </View>

        <Text style={styles.title}>{KIND_LABEL[props.kind]}</Text>

        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.label}>Patient</Text>
            <Text style={styles.value}>{props.patient.last_name}, {props.patient.first_name}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Date of birth</Text>
            <Text style={styles.value}>{props.patient.birth_date ?? '—'}</Text>
          </View>
        </View>

        {props.body.recipient ? (
          <View>
            <Text style={styles.label}>To</Text>
            <Text style={styles.value}>{String(props.body.recipient)}</Text>
          </View>
        ) : null}

        <View style={styles.body}>
          {lines.length > 0
            ? lines.map((line, i) => <Text key={i} style={styles.value}>{line}</Text>)
            : <Text style={styles.value}>—</Text>}
        </View>

        {props.status === 'signed' && props.signer ? (
          <View style={styles.signature}>
            <Text>{props.signer.full_name}</Text>
            {props.signer.prc_license_no
              ? <Text style={styles.itemMeta}>PRC Licence No. {props.signer.prc_license_no}</Text>
              : null}
            <Text style={styles.itemMeta}>Signed {props.signedAt ?? ''}</Text>
          </View>
        ) : (
          <View style={styles.signature}>
            <Text style={styles.itemMeta}>Pending physician review and signature</Text>
          </View>
        )}

        <Text style={styles.footer} fixed>
          {props.status === 'signed'
            ? `Signed document. Integrity hash ${(props.contentHash ?? '').slice(0, 16)}…`
            : 'DRAFT — pending physician review and signature. Not valid for dispensing.'}
        </Text>
      </Page>
    </Document>
  );
}
