'use client';

import { forwardRef, useState, type ComponentProps } from 'react';
import Image from 'next/image';
import { avatarColor, initials } from '@/utils/avatar';
import { mediaUrl } from '@/lib/api/core/media';
import { cn } from '@/lib/utils';

// A person's avatar. With an uploaded `image` it shows that picture; otherwise
// (or if the image fails to load) it falls back to a colored circle with their
// initials, deterministic per name (same name → same color, see
// avatarColor/initials in lib/avatar). The default size matches the issue-card
// avatar; pass a size-* className to scale it (comments use a larger one) — the
// initials follow on their own (40% of the avatar, see [data-slot='avatar'] in
// globals.css), so a call site never sets a text size. forwardRef + spread so it
// works as a Radix Tooltip/Popover `asChild` trigger.
const Avatar = forwardRef<
  HTMLSpanElement,
  ComponentProps<'span'> & { name: string; image?: string | null }
>(({ name, image, className, ...props }, ref) => {
  // The url that failed to load, not a flag: the same mounted Avatar is reused for a
  // different person (a select trigger) or gets a freshly uploaded picture, and both
  // must try the new url again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(image) && failedSrc !== image;

  return (
    <span
      ref={ref}
      data-slot="avatar"
      className={cn(
        'relative inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white',
        className,
      )}
      {...props}
      style={{
        backgroundColor: showImage ? undefined : avatarColor(initials(name)),
        ...props.style,
      }}
    >
      {showImage ? (
        <Image
          src={mediaUrl(image!)}
          alt={name}
          fill
          // The largest avatar in the app is size-16 (64px); everything else is
          // smaller, so one candidate width covers them all.
          sizes="64px"
          draggable={false}
          className="object-cover"
          onError={() => setFailedSrc(image!)}
        />
      ) : (
        <span data-slot="avatar-initials">{initials(name)}</span>
      )}
    </span>
  );
});
Avatar.displayName = 'Avatar';

export default Avatar;
