'use client';

import { useEffect, useRef, useState } from 'react';
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
  }, [html, allowRemoteImages, links]);

  return (
    <iframe
      ref={frameRef}
      title="mail"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={mailFrameDocument({ html, apiBase: mailApiBase(), allowRemoteImages })}
      className="w-full rounded-sm bg-white"
      style={{ height }}
    />
  );
}
