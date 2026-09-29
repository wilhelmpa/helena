'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { useWebLinks } from '@/context/webLinks';
import { installWebLinkNavigation } from '@/utils/webLinkNavigation';
import { webLinkScope } from '@/utils/webLinkScope';
import { mailApiBase } from '@/lib/api/endpoints/mail';
import { mailFrameDocument } from '../utils/mailHtml';

// The HTML of a message in a sandboxed frame: no scripts, no access to the app, and
// as tall as its content. The parent measures it and routes clicked web links;
// without allow-scripts nothing inside the frame can execute code.
export default function MailHtmlFrame({
  html,
  allowRemoteImages,
}: {
  html: string;
  allowRemoteImages: boolean;
}) {
  const links = useWebLinks();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  // The frame paints the app's own surface, read from the tokens, not a colour of its own.
  const surface = useMemo(
    () =>
      typeof document === 'undefined' || !dark
        ? undefined
        : getComputedStyle(document.documentElement).getPropertyValue('--surface-1').trim(),
    [dark],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    let unlink: (() => void) | undefined;
    let linkedDocument: Document | null = null;
    const measure = () => {
      const body = frame.contentDocument?.body;
      if (!body) return;
      const doc = frame.contentDocument!;
      if (links && doc !== linkedDocument) {
        unlink?.();
        linkedDocument = doc;
        unlink = installWebLinkNavigation(
          doc,
          links.open,
          () => webLinkScope(frame, links.scope),
          window.location.href,
        );
      }
      setHeight(
        Math.max(body.scrollHeight, frame.contentDocument!.documentElement.scrollHeight) + 4,
      );
      if (!observer) {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    frame.addEventListener('load', measure);
    if (frame.contentDocument?.readyState === 'complete') measure();
    return () => {
      frame.removeEventListener('load', measure);
      observer?.disconnect();
      unlink?.();
    };
  }, [html, allowRemoteImages, links, dark, surface]);

  return (
    <iframe
      ref={frameRef}
      title="mail"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={mailFrameDocument({ html, apiBase: mailApiBase(), allowRemoteImages, dark, surface })}
      className={cn('w-full rounded-sm', !dark && 'bg-white')}
      style={{ height }}
    />
  );
}
