import React from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { styles, DRAFT_WATERMARK, shouldWatermark } from './theme';
import type { ProgramItem } from '@/server/programs';

export interface ProgramPdfProps {
  title: string;
  discipline: string;
  status: 'draft' | 'signed';
  items: ProgramItem[];
  patient: { first_name: string; last_name: string; birth_date?: string | null };
  clinic: { name: string; address?: string | null; phone?: string | null };
  signer?: { full_name: string; prc_license_no?: string | null } | null;
}

/** The patient's home programme (spec §7), printed on clinic letterhead. */
export function ProgramPdf(props: ProgramPdfProps) {
  const isDraft = shouldWatermark(props.status);

  return (
    <Document title={props.title}>
      <Page size="A4" style={styles.page}>
        {isDraft && <Text style={styles.watermark} fixed>{DRAFT_WATERMARK}</Text>}

        <View style={styles.letterhead}>
          <Text style={styles.clinicName}>{props.clinic.name}</Text>
          {props.clinic.address ? <Text style={styles.clinicMeta}>{props.clinic.address}</Text> : null}
          {props.clinic.phone ? <Text style={styles.clinicMeta}>Tel: {props.clinic.phone}</Text> : null}
        </View>

        <Text style={styles.title}>{props.discipline} Programme — {props.title}</Text>

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

        <View style={styles.body}>
          {props.items.length === 0 ? (
            <Text style={styles.value}>No exercises have been added to this programme yet.</Text>
          ) : props.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text style={styles.itemName}>{i + 1}. {item.exercise}</Text>
              <Text style={styles.itemMeta}>
                {[item.sets && `${item.sets} sets`, item.reps && `${item.reps} reps`, item.frequency]
                  .filter(Boolean).join(' · ')}
              </Text>
              {item.notes ? <Text style={styles.itemMeta}>{item.notes}</Text> : null}
            </View>
          ))}
        </View>

        {props.status === 'signed' && props.signer ? (
          <View style={styles.signature}>
            <Text>{props.signer.full_name}</Text>
            {props.signer.prc_license_no
              ? <Text style={styles.itemMeta}>PRC Licence No. {props.signer.prc_license_no}</Text>
              : null}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {isDraft
            ? 'DRAFT — pending clinician review and signature.'
            : 'Stop any exercise that causes sharp or worsening pain and contact the clinic.'}
        </Text>
      </Page>
    </Document>
  );
}
