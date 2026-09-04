import Image from 'next/image';
import { getImage, type ImageKey } from '@/lib/images';
import { PlaceholderArt } from './PlaceholderArt';

/**
 * One image slot. Renders the photograph once the manifest has one, and brand
 * artwork until then — same box, same aspect ratio either way, so the page
 * never reflows when real photography arrives.
 */
export function Figure({
  slot, className = '', rounded = 'rounded-2xl', priority = false, sizes = '100vw',
}: {
  slot: ImageKey;
  className?: string;
  rounded?: string;
  /** Set on the largest above-the-fold image so it is not lazy-loaded. */
  priority?: boolean;
  sizes?: string;
}) {
  const image = getImage(slot);
  const [w, h] = image.ratio;
  const seed = [...slot].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

  return (
    <figure className={`relative overflow-hidden border border-line bg-raised ${rounded} ${className}`}
            style={{ aspectRatio: `${w} / ${h}` }}>
      {image.src ? (
        <Image
          src={image.src}
          alt={image.alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <PlaceholderArt motif={image.motif} seed={seed} />
      )}

      {image.credit ? (
        <figcaption className="absolute bottom-0 right-0 rounded-tl-lg bg-surface/80 px-2 py-1 text-[10px] text-muted backdrop-blur">
          {image.credit.url
            ? <a href={image.credit.url} rel="nofollow noopener" className="hover:underline">{image.credit.name}</a>
            : image.credit.name}
          {image.credit.source ? ` · ${image.credit.source}` : ''}
        </figcaption>
      ) : null}
    </figure>
  );
}
