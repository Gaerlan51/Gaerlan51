import React from 'react';
import type { Motif } from '@/lib/images';

/**
 * Brand artwork drawn in an image slot until a photograph exists.
 *
 * Deliberately abstract. A clinic site filled with stock photos of strangers
 * posing as patients reads as borrowed; a considered graphic reads as
 * intentional, and it will never be mistaken for a real patient. Colours come
 * from the theme tokens, so these follow light and dark like everything else.
 */
export function PlaceholderArt({
  motif, seed = 0, className = '',
}: { motif: Motif; seed?: number; className?: string }) {
  const uid = React.useId().replace(/:/g, '');
  // Mirror alternate slots and move the light source, so two slots sharing a
  // motif still read as two different pictures.
  const flip = seed % 2 === 1;
  const glow = [
    { cx: 0.78, cy: 0.22 }, { cx: 0.24, cy: 0.18 },
    { cx: 0.68, cy: 0.78 }, { cx: 0.14, cy: 0.72 },
  ][seed % 4];

  const common = {
    className: `h-full w-full ${className}`,
    viewBox: '0 0 400 300',
    preserveAspectRatio: 'xMidYMid slice' as const,
    role: 'presentation' as const,
    'aria-hidden': true,
    style: flip ? { transform: 'scaleX(-1)' } : undefined,
  };

  const Ground = () => (
    <>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity="0.28" />
          <stop offset="55%" stopColor="rgb(var(--brand))" stopOpacity="0.13" />
          <stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity="0.34" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx={glow.cx} cy={glow.cy} r="0.7">
          <stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity="0.38" />
          <stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="300" fill="rgb(var(--raised))" />
      <rect width="400" height="300" fill={`url(#${uid}-bg)`} />
      <rect width="400" height="300" fill={`url(#${uid}-glow)`} />
    </>
  );

  const stroke = 'rgb(var(--brand))';

  switch (motif) {
    // Range of motion: arcs sweeping from a fixed joint.
    case 'motion':
      return (
        <svg {...common}>
          <Ground />
          <g fill="none" stroke={stroke} strokeLinecap="round">
            {[46, 78, 110, 142, 174].map((r, i) => (
              <path
                key={r}
                d={`M ${96 + r} 236 A ${r} ${r} 0 0 0 ${96} ${236 - r}`}
                strokeWidth={3}
                opacity={0.72 - i * 0.10}
              />
            ))}
          </g>
          <circle cx="96" cy="236" r="9" fill={stroke} opacity="0.85" />
          <circle cx="96" cy="236" r="20" fill="none" stroke={stroke} strokeWidth="1.5" opacity="0.35" />
        </svg>
      );

    // Gait: rhythmic footfalls advancing along a path.
    case 'gait':
      return (
        <svg {...common}>
          <Ground />
          <path d="M-10 214 C 90 194, 180 232, 300 196 S 420 176, 420 176"
                fill="none" stroke={stroke} strokeWidth="2" opacity="0.5" strokeLinecap="round" />
          <g fill={stroke}>
            {[[28, 210], [82, 200], [136, 214], [190, 220], [244, 206], [298, 194], [352, 186]]
              .map(([x, y], i) => (
                <rect key={x} x={x} y={y - 26} width="13" height="30" rx="6.5"
                      opacity={0.30 + i * 0.10} transform={`rotate(${-8 + i * 2} ${x + 6} ${y})`} />
              ))}
          </g>
          <g fill="none" stroke={stroke} strokeWidth="1.4" opacity="0.22">
            <path d="M0 250h400M0 268h400" />
          </g>
        </svg>
      );

    // Progress: a steady trace over soft ground.
    case 'pulse':
      return (
        <svg {...common}>
          <Ground />
          <circle cx="310" cy="96" r="74" fill={stroke} opacity="0.16" />
          <circle cx="104" cy="212" r="52" fill={stroke} opacity="0.13" />
          <path
            d="M-10 172 H 78 l 22 -58 26 118 24 -78 18 30 h 44 l 20 -44 22 68 20 -36 H 420"
            fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            opacity="0.75"
          />
        </svg>
      );

    // Support: two forms turned toward each other, meeting in the middle.
    // An earlier version put a circle above two arcs and read as a face — at
    // card size the eye assembles anything roughly head-shaped into one.
    case 'care':
      return (
        <svg {...common}>
          <Ground />
          <g fill="none" stroke={stroke} strokeLinecap="round">
            <path d="M150 62 C 88 100, 84 200, 148 240" strokeWidth="22" opacity="0.30" />
            <path d="M250 62 C 312 100, 316 200, 252 240" strokeWidth="22" opacity="0.42" />
            <path d="M182 151 h36" strokeWidth="10" opacity="0.85" />
          </g>
          <g fill={stroke}>
            <circle cx="200" cy="151" r="7" opacity="0.9" />
            <rect x="120" y="266" width="160" height="9" rx="4.5" opacity="0.22" />
          </g>
        </svg>
      );

    // A room: planes of light, no people.
    case 'room':
    default:
      return (
        <svg {...common}>
          <Ground />
          <g stroke={stroke} fill="none">
            <path d="M0 196 H400" strokeWidth="1.6" opacity="0.38" />
            <path d="M52 196 V 92 h 118 v 104" strokeWidth="2" opacity="0.58" />
            <path d="M212 196 V 126 h 92 v 70" strokeWidth="2" opacity="0.44" />
            <path d="M330 196 V 150 h 54 v 46" strokeWidth="2" opacity="0.32" />
          </g>
          <g fill={stroke}>
            <rect x="72" y="112" width="78" height="52" rx="4" opacity="0.24" />
            <rect x="228" y="142" width="60" height="38" rx="4" opacity="0.20" />
            <rect x="40" y="206" width="150" height="12" rx="6" opacity="0.36" />
            <rect x="212" y="206" width="96" height="12" rx="6" opacity="0.26" />
          </g>
        </svg>
      );
  }
}
