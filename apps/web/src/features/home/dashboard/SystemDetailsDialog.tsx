'use client';

import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import HomeSystemHealth from '../components/home/HomeSystemHealth';
import { closeSystemDetails, useSystemDetailsOpen } from './systemDetails';

// The full health overview (services, engine, runs, logins with the command that signs one
// in again, agents in sync, maintenance, the machine), opened from the System tile or a red
// problem in "Braucht dich". For the Administrator; Start mounts it once.
export default function SystemDetailsDialog() {
  const t = useTranslations('home.system');
  const open = useSystemDetailsOpen();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : closeSystemDetails())}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
      >
        <DialogTitle>{t('title')}</DialogTitle>
        <HomeSystemHealth />
      </DialogContent>
    </Dialog>
  );
}
