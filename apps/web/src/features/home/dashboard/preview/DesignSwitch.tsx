'use client';

import { useSyncExternalStore } from 'react';
import DesignA from './DesignA';
import DesignB from './DesignB';
import DesignC from './DesignC';

const subscribe = () => () => {};

// Preview only (the owner picks one): ?design=a|b|c.
export default function DesignSwitch() {
  const design = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get('design') ?? 'a',
    () => 'a',
  );
  if (design === 'b') return <DesignB />;
  if (design === 'c') return <DesignC />;
  return <DesignA />;
}
