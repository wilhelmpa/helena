import { useEffect, useState } from 'react';

// The screen's device pixel ratio, which changes when the window moves to another screen or
// the browser zoom changes.
export function useDevicePixelRatio() {
  const [ratio, setRatio] = useState(1);
  useEffect(() => {
    let query: MediaQueryList | null = null;
    const watch = () => {
      setRatio(window.devicePixelRatio);
      query?.removeEventListener('change', watch);
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', watch);
    };
    watch();
    return () => query?.removeEventListener('change', watch);
  }, []);
  return ratio;
}
