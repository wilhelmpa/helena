'use client';

import { useEffect, useRef, useState } from 'react';
import { mailApiBase } from '@/lib/api/endpoints/mail';
import { mailFrameDocument } from '../utils/mailHtml';

// The HTML of a message in a sandboxed frame: no scripts, no access to the app, and
// as tall as its content. allow-same-origin only lets this page measure the height;
// without allow-scripts nothing inside the frame can use it.
export default function MailHtmlFrame({
  html,
  allowRemoteImages,
}: {
  html: string;
  allowRemoteImages: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const body = frame.contentDocument?.body;
      if (!body) return;
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
    };
  }, [html, allowRemoteImages]);

  return (
    <iframe
      ref={frameRef}
      title="mail"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={mailFrameDocument({ html, apiBase: mailApiBase(), allowRemoteImages })}
      className="w-full rounded bg-white"
      style={{ height }}
    />
  );
}
