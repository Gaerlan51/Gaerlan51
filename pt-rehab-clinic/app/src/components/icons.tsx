import React from 'react';

/**
 * Inline stroke icons. Hand-rolled rather than an icon package: the set is
 * small, it keeps the bundle free of a dependency the spec did not sanction,
 * and everything inherits currentColor so it themes for free.
 */
type IconProps = React.SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      width={20} height={20} {...props}
    >
      {children}
    </svg>
  );
}

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></Icon>
);
export const IconUsers = (p: IconProps) => (
  <Icon {...p}><path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" /><circle cx="9.5" cy="7.5" r="3.5" /><path d="M17 11a3 3 0 1 0-1.5-5.6M21 20v-1a3.5 3.5 0 0 0-2.5-3.4" /></Icon>
);
export const IconChart = (p: IconProps) => (
  <Icon {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icon>
);
export const IconBell = (p: IconProps) => (
  <Icon {...p}><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" /><path d="M10.5 20a2 2 0 0 0 3 0" /></Icon>
);
export const IconShield = (p: IconProps) => (
  <Icon {...p}><path d="M12 3l7 3v5.5c0 4.6-3 8.3-7 9.5-4-1.2-7-4.9-7-9.5V6z" /><path d="M9.5 12l1.8 1.8L15 10" /></Icon>
);
export const IconPulse = (p: IconProps) => (
  <Icon {...p}><path d="M3 12h3.5l2-6 3.5 12 2.5-8 1.5 2H21" /></Icon>
);
export const IconStethoscope = (p: IconProps) => (
  <Icon {...p}><path d="M6 3v5a4 4 0 0 0 8 0V3" /><path d="M4 3h3M13 3h3M10 12v3a5 5 0 0 0 10 0v-1" /><circle cx="20" cy="12" r="2" /></Icon>
);
export const IconHand = (p: IconProps) => (
  <Icon {...p}><path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-3a1.5 1.5 0 0 1 3 0" /></Icon>
);
export const IconSpeech = (p: IconProps) => (
  <Icon {...p}><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14.5h3.5" /></Icon>
);
export const IconBrain = (p: IconProps) => (
  <Icon {...p}><path d="M12 5a3 3 0 0 0-5.7-1.3A3 3 0 0 0 4 9a3 3 0 0 0 1 5.6A3 3 0 0 0 9 20a3 3 0 0 0 3-2.5zM12 5a3 3 0 0 1 5.7-1.3A3 3 0 0 1 20 9a3 3 0 0 1-1 5.6A3 3 0 0 1 15 20a3 3 0 0 1-3-2.5z" /></Icon>
);
export const IconNeedle = (p: IconProps) => (
  <Icon {...p}><path d="M20 4L9.5 14.5M17 3l4 4M9.5 14.5l-1.8.4-.4 1.8-3.8 3.8" /><path d="M12 12l2 2" /></Icon>
);
export const IconLimb = (p: IconProps) => (
  <Icon {...p}><path d="M9 3h5l-1 6 3 4v4a4 4 0 0 1-8 0v-5l2-3z" /><path d="M8 21h8" /></Icon>
);
export const IconPin = (p: IconProps) => (
  <Icon {...p}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></Icon>
);
export const IconPhone = (p: IconProps) => (
  <Icon {...p}><path d="M5 3h3.5l1.5 4.5-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4.5 1.5V18a2.5 2.5 0 0 1-2.8 2.5A16 16 0 0 1 2.5 5.8 2.5 2.5 0 0 1 5 3z" /></Icon>
);
export const IconMail = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></Icon>
);
export const IconClock = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.5l3.5 2" /></Icon>
);
export const IconCheck = (p: IconProps) => (
  <Icon {...p}><path d="M4.5 12.5l5 5L20 7" /></Icon>
);
export const IconArrow = (p: IconProps) => (
  <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
);
export const IconMenu = (p: IconProps) => (
  <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
);
export const IconClose = (p: IconProps) => (
  <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>
);
export const IconEye = (p: IconProps) => (
  <Icon {...p}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.8" /></Icon>
);
export const IconEyeOff = (p: IconProps) => (
  <Icon {...p}><path d="M3 3l18 18" /><path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.3 4M6.4 8.2A16.7 16.7 0 0 0 2 12s3.6 6 10 6a9.8 9.8 0 0 0 4-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icon>
);
export const IconLock = (p: IconProps) => (
  <Icon {...p}><rect x="4.5" y="10" width="15" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>
);
export const IconDoc = (p: IconProps) => (
  <Icon {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></Icon>
);
export const IconLog = (p: IconProps) => (
  <Icon {...p}><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="19" cy="18" r="2" /></Icon>
);

/**
 * Mark: an abstract range-of-motion arc rather than a medical cross.
 * `inverted` swaps the fills for use on a brand-coloured panel, where the
 * default would be teal on teal and effectively invisible.
 */
export function Logo({
  className = 'h-8 w-8', inverted = false,
}: { className?: string; inverted?: boolean }) {
  const plate = inverted ? 'rgb(var(--brand-ink))' : 'rgb(var(--brand))';
  const mark = inverted ? 'rgb(var(--brand))' : 'rgb(var(--brand-ink))';
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect width="40" height="40" rx="11" fill={plate} />
      <path d="M11 27a9 9 0 0 1 18 0" fill="none" stroke={mark}
            strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="20" cy="15.5" r="3.2" fill={mark} />
      <path d="M14.5 31h11" stroke={mark} strokeWidth="2.6"
            strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
