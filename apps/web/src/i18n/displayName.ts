import { cache } from 'react';
import { serverRuntimeEnv } from '@/utils/runtimeEnv';

export const getDisplayName = cache(async (): Promise<string> => {
  const apiUrl = serverRuntimeEnv().apiUrl;
  const response = await fetch(`${apiUrl}/display-name`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not read display name');
  const data: { displayName: string } = await response.json();
  return data.displayName;
});
