/**
 * Image manifest for the public site.
 *
 * Each slot names the photograph that belongs there, its alt text and its
 * aspect ratio. `src` is empty until real artwork exists, and the <Figure>
 * component draws brand artwork in the meantime — so the layout is final and
 * dropping a photo in is a one-line change per slot, never a redesign.
 *
 * To fill these with licensed stock: `npm run fetch:stock` (see
 * scripts/fetch-stock.mjs). To use the clinic's own photography, drop files in
 * public/images/ and set `src` below.
 *
 * TWO RULES for whatever goes in these slots:
 *   1. Never a real patient. Photographs of patients — even happy ones, even
 *      with a signed form on file — are health information under RA 10173 and
 *      do not belong on a marketing page. Stock models or staff only.
 *   2. Credit what the licence requires. `credit` is rendered by <Figure>.
 */

export type Motif = 'motion' | 'gait' | 'pulse' | 'care' | 'room';

export interface ImageSlot {
  /** Path under /public, or empty to draw the placeholder artwork. */
  src: string;
  /** Describes the image for someone who cannot see it. Never decorative filler. */
  alt: string;
  /** width/height, used to reserve space and prevent layout shift. */
  ratio: [number, number];
  /** Artwork drawn while src is empty. */
  motif: Motif;
  /** What to search for when sourcing the real photograph. */
  brief: string;
  credit?: { name: string; url?: string; source?: string };
}

export const images = {
  practice: {
    src: '',
    alt: 'A therapist supporting a patient through a shoulder exercise in a bright clinic gym.',
    ratio: [21, 9],
    motif: 'motion',
    brief: 'physical therapist guiding patient exercise, bright clinic, natural light, wide',
  },
  about: {
    src: '',
    alt: 'Clinicians reviewing a rehabilitation plan together at a workstation.',
    ratio: [16, 9],
    motif: 'care',
    brief: 'medical team reviewing notes together, warm professional clinic setting',
  },
  services: {
    src: '',
    alt: 'A gait training session along parallel bars in a rehabilitation gym.',
    ratio: [21, 9],
    motif: 'gait',
    brief: 'gait training parallel bars rehabilitation gym wide shot',
  },
  // Each branch takes a different motif: five identical placeholders in a row
  // read as a loading bug rather than a considered design.
  'branch-1': { src: '', alt: 'Reception area at Branch One.', ratio: [16, 9], motif: 'room',
                brief: 'modern clinic reception waiting area, calm, daylight' },
  'branch-2': { src: '', alt: 'Treatment room at Branch Two.', ratio: [16, 9], motif: 'care',
                brief: 'physiotherapy treatment room with plinth, clean and bright' },
  'branch-3': { src: '', alt: 'Therapy gym at Branch Three.', ratio: [16, 9], motif: 'gait',
                brief: 'rehabilitation gym equipment wide, uncluttered' },
  'branch-4': { src: '', alt: 'Consultation room at Branch Four.', ratio: [16, 9], motif: 'pulse',
                brief: 'doctor consultation room, desk and examination couch' },
  'branch-5': { src: '', alt: 'Paediatric therapy space at Branch Five.', ratio: [16, 9], motif: 'motion',
                brief: 'paediatric occupational therapy room, colourful but calm' },
} satisfies Record<string, ImageSlot>;

import generated from './images.generated.json';

/**
 * Written by `npm run fetch:stock`, empty until then. Kept out of the manifest
 * above so a fetched photograph never overwrites a hand-written brief or alt
 * text — only the file path and the credit come from the fetcher.
 */
const fetched = generated as Record<string, { src: string; credit?: ImageSlot['credit'] }>;

export type ImageKey = keyof typeof images;

/**
 * `satisfies` keeps the key names literal for autocomplete but narrows each
 * entry to exactly the fields it declares, which drops optional ones like
 * `credit`. Read slots through here to get the full ImageSlot shape back.
 */
export const getImage = (key: ImageKey): ImageSlot => {
  const slot: ImageSlot = images[key];
  const overlay = fetched[key];
  return overlay?.src ? { ...slot, src: overlay.src, credit: overlay.credit ?? slot.credit } : slot;
};

export const hasPhoto = (key: ImageKey): boolean => getImage(key).src !== '';
