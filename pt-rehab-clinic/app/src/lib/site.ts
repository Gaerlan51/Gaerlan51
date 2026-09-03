/**
 * Single source of truth for everything shown on the public site.
 *
 * TODO(owner) — replace before launch (spec §14, §15):
 *   · network + branch names, addresses, phone numbers, opening hours
 *   · the doctor's full name and PRC licence number
 *   · logo / letterhead artwork
 *   · the inquiry email address
 *
 * Nothing here is patient data, and nothing here is fetched from the database:
 * the marketing pages are static by design so a public page can never leak a
 * record (RA 10173).
 */

export const site = {
  name: 'Rehabilitation Network',
  tagline: 'Physiatry, therapy and medical acupuncture across five branches',
  description:
    'A physician-led rehabilitation practice: physiatry consultations, medical ' +
    'acupuncture, and physical, occupational, speech and psychological therapy, ' +
    'with prosthetics and orthotics programmes.',
  email: 'inquiries@example.ph',
  phone: '(02) 8555-0100',
  hours: 'Monday to Saturday, 8:00 AM – 6:00 PM',
} as const;

export interface ServiceEntry {
  slug: string;
  name: string;
  short: string;
  detail: string;
  treats: string[];
}

export const services: ServiceEntry[] = [
  {
    slug: 'physiatry',
    name: 'Physiatry consultation',
    short: 'A rehabilitation physician assesses the whole picture and sets the plan.',
    detail:
      'Rehabilitation medicine treats function, not just the injury. Your first ' +
      'consultation covers history, physical examination and a written plan naming ' +
      'which therapies you need, how often, and when you will be reviewed.',
    treats: ['Back and neck pain', 'Post-stroke recovery', 'Sports injury', 'Arthritis'],
  },
  {
    slug: 'acupuncture',
    name: 'Medical acupuncture',
    short: 'Needling delivered by a physician, alongside your rehabilitation plan.',
    detail:
      'Medical acupuncture is performed by a trained physician as part of a wider ' +
      'plan rather than in isolation. It is most often used for musculoskeletal ' +
      'pain and headache, and is discussed with you before it begins.',
    treats: ['Chronic pain', 'Headache', 'Myofascial pain', 'Frozen shoulder'],
  },
  {
    slug: 'physical-therapy',
    name: 'Physical therapy',
    short: 'Restoring strength, movement and balance after injury or illness.',
    detail:
      'Hands-on treatment plus a home programme you can actually follow. Sessions ' +
      'are logged, and after every six the doctor reviews progress before therapy ' +
      'continues.',
    treats: ['Post-operative recovery', 'Stroke and neuro rehab', 'Low back pain', 'Gait training'],
  },
  {
    slug: 'occupational-therapy',
    name: 'Occupational therapy',
    short: 'Rebuilding the daily tasks that matter — dressing, writing, working.',
    detail:
      'Occupational therapy targets the activities of daily living: fine motor ' +
      'control, hand function, self-care, and returning to work or school.',
    treats: ['Hand injuries', 'Paediatric development', 'Post-stroke ADLs', 'Sensory processing'],
  },
  {
    slug: 'speech-therapy',
    name: 'Speech therapy',
    short: 'Speech, language and swallowing assessment and treatment.',
    detail:
      'For children with delayed speech and for adults recovering communication or ' +
      'swallowing after a stroke or injury. Family coaching is part of the plan.',
    treats: ['Speech delay', 'Aphasia', 'Swallowing difficulty', 'Articulation'],
  },
  {
    slug: 'psychological-services',
    name: 'Psychological services',
    short: 'Support for the mental load that comes with a long recovery.',
    detail:
      'Assessment and counselling for patients and families living with pain, ' +
      'disability or a long rehabilitation. Provided in confidence, coordinated ' +
      'with the rest of your care.',
    treats: ['Adjustment to injury', 'Chronic pain coping', 'Paediatric assessment', 'Caregiver support'],
  },
  {
    slug: 'prosthetics-orthotics',
    name: 'Prosthetics & orthotics',
    short: 'Fitting, training and follow-up for braces, supports and prostheses.',
    detail:
      'A prosthetics and orthotics programme runs alongside therapy: fitting, gait ' +
      'training, skin checks and adjustment as you change.',
    treats: ['Limb loss', 'Foot and ankle bracing', 'Spinal orthoses', 'Post-amputation gait'],
  },
];

export interface BranchEntry {
  id: string;
  name: string;
  area: string;
  address: string;
  phone: string;
  services: string[];
}

export const branches: BranchEntry[] = [
  { id: 'branch-1', name: 'Branch One', area: 'Quezon City', address: 'Address to confirm',
    phone: '(02) 8555-0101', services: ['Physiatry', 'PT', 'OT', 'Acupuncture'] },
  { id: 'branch-2', name: 'Branch Two', area: 'Makati', address: 'Address to confirm',
    phone: '(02) 8555-0102', services: ['Physiatry', 'PT', 'Speech', 'Psych'] },
  { id: 'branch-3', name: 'Branch Three', area: 'Pasig', address: 'Address to confirm',
    phone: '(02) 8555-0103', services: ['PT', 'OT', 'Prosthetics & orthotics'] },
  { id: 'branch-4', name: 'Branch Four', area: 'Caloocan', address: 'Address to confirm',
    phone: '(02) 8555-0104', services: ['Physiatry', 'PT', 'Acupuncture'] },
  { id: 'branch-5', name: 'Branch Five', area: 'Parañaque', address: 'Address to confirm',
    phone: '(02) 8555-0105', services: ['PT', 'OT', 'Speech'] },
];

export const payers = [
  { name: 'PhilHealth', note: 'Accredited benefits applied at the branch' },
  { name: 'HMO cards', note: 'Major providers accepted — confirm coverage when booking' },
  { name: 'Cash / GCash', note: 'Settled at the point of service' },
  { name: 'Physician referral', note: 'We report back to your referring doctor' },
];

export const faqs = [
  {
    q: 'Do I need a referral to be seen?',
    a: 'No. You can book a physiatry consultation directly. If another doctor referred ' +
       'you, bring their letter and we will write back to them with our findings.',
  },
  {
    q: 'How often will the doctor review my progress?',
    a: 'After every six therapy sessions for musculoskeletal and neurologic cases, and ' +
       'monthly for paediatric rehabilitation. The review is scheduled for you rather ' +
       'than left to chance.',
  },
  {
    q: 'Can I use PhilHealth or my HMO?',
    a: 'Yes. Bring your PhilHealth details or HMO card to your first visit. Coverage ' +
       'varies by plan, so the front desk will confirm what applies to you before ' +
       'treatment begins.',
  },
  {
    q: 'Can I transfer between branches?',
    a: 'Your care is based at one branch so that one team stays responsible for it. ' +
       'Talk to the front desk if you need to move — they will arrange the handover.',
  },
  {
    q: 'How long is a therapy session?',
    a: 'Most sessions run about an hour, and your programme will say how many times a ' +
       'week to attend. You will also get exercises to continue at home.',
  },
];
