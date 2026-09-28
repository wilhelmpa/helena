'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronsUpDown,
  Info,
  LogOut,
  OctagonX,
  Play,
  Languages,
  Moon,
  Sun,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { signOut, useSession } from '@/lib/auth-client';
import { ACCOUNT_SECTIONS, accountPath } from '@/utils/accountSections';
import { godPath } from '@/utils/paths';
import { GOD_SECTIONS } from '@/utils/godSections';
import { LOCALES, LOCALE_FLAGS, LOCALE_LABELS, type Locale } from '@/i18n/locales';
import { useUpdateAccountPreferences } from '@/services/preferences.service';
import { useAccountSectionLabel } from '@/hooks/useSectionLabels';
import { runtimeEnv } from '@/utils/runtimeEnv';
import Avatar from '@/components/common/Avatar';
import AboutHelenaDialog from '@/components/brand/AboutHelenaDialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { EmergencyStopDialog } from '@/features/agent-runtime/components/EmergencyStop';
import {
  useEmergencyStop,
  useSetEmergencyStop,
} from '@/features/agent-runtime/services/agentRuntime.service';

// Signed-in user control in the header: shows the account avatar and a menu with
// the email, the role, links to preferences, connected accounts, account security
// (passkeys) and API keys, sign out, and "Über Helena" (what it is, and the project it
// is a fork of).
// Signing out clears the session and the proxy sends the browser back to
// the login page.
//
// `avatar` is the round trigger of the classic header; `row` is the sidebar footer's
// account row — avatar, name and a chevron in one 32px sidebar row that fills the
// width (the name hides when the sidebar collapses to icons).
export default function UserMenu({ variant = 'avatar' }: { variant?: 'avatar' | 'row' }) {
  const t = useTranslations('nav');
  // The instance role in words ('god' is the Administrator), never the raw value.
  const tUsers = useTranslations('god.users');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const preferences = useUpdateAccountPreferences();
  const sectionLabel = useAccountSectionLabel();
  const router = useRouter();
  const tStop = useTranslations('agentRuntime.emergencyStop');
  const { data: session, isPending } = useSession();
  // The owner's "Not-Aus" sits in this menu; its confirmation lives outside the menu,
  // which unmounts its items when it closes.
  const emergencyStop = useEmergencyStop().data;
  const setEmergencyStop = useSetEmergencyStop();
  const [stopping, setStopping] = useState(false);
  const [about, setAbout] = useState(false);

  // better-auth reads the session on the client, so the server renders no user and
  // the client may already have a cached session. Render the placeholder until
  // mounted so the first client render matches the server and hydration succeeds.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || isPending)
    return (
      <Skeleton
        className={cn('rounded-full', variant === 'row' ? 'size-6 flex-1 rounded-md' : 'size-7')}
      />
    );
  if (!session) return null;

  const { user } = session;
  const role = (user as { role?: string }).role ?? 'user';
  const image = (user as { image?: string | null }).image ?? null;

  async function onSignOut() {
    await signOut();
    const logoutUrl = runtimeEnv().logoutUrl;
    if (logoutUrl) {
      try {
        const target = new URL(logoutUrl, window.location.origin);
        if (target.origin === window.location.origin) {
          window.location.assign(target.toString());
          return;
        }
      } catch {
        // Invalid deployment configuration falls back to the local login page.
      }
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              {variant === 'row' ? (
                <button
                  type="button"
                  aria-label={user.email}
                  className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-start text-sm text-sidebar-foreground outline-none group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent"
                >
                  <Avatar
                    name={user.name || user.email}
                    image={image}
                    className="size-6 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
                    {user.name || user.email}
                  </span>
                  <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                </button>
              ) : (
                <button type="button" aria-label={user.email} className="rounded-full outline-none">
                  <Avatar name={user.name || user.email} image={image} className="size-7" />
                </button>
              )}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{user.email}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align={variant === 'row' ? 'start' : 'end'}
          side={variant === 'row' ? 'top' : undefined}
          className="w-56"
        >
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="truncate text-sm font-medium">{user.email}</span>
            <span className="text-xs text-muted-foreground">
              {t('role', { role: tUsers(role === 'god' ? 'roleGod' : 'roleUser') })}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ACCOUNT_SECTIONS.map(({ slug, icon: Icon }) => (
            <DropdownMenuItem key={slug} asChild>
              <Link href={accountPath(slug)}>
                <Icon />
                {sectionLabel(slug)}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Languages />
              {tCommon('language')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {LOCALES.map((value) => (
                <DropdownMenuItem
                  key={value}
                  onSelect={() => preferences.mutate({ locale: value })}
                >
                  <span aria-hidden>{LOCALE_FLAGS[value]}</span>
                  {LOCALE_LABELS[value]}
                  {value === (locale as Locale) && <span className="ms-auto">{'✓'}</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onSelect={() => {
              const next = resolvedTheme === 'dark' ? 'light' : 'dark';
              setTheme(next);
              preferences.mutate({ theme: next });
            }}
          >
            {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
            {tCommon('toggleTheme')}
          </DropdownMenuItem>
          {role === 'god' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={godPath(GOD_SECTIONS[0]!.slug)}>
                  <Settings />
                  {t('godMode')}
                </Link>
              </DropdownMenuItem>
              {emergencyStop?.active ? (
                <DropdownMenuItem
                  onSelect={() =>
                    setEmergencyStop.mutate(
                      { active: false },
                      { onSuccess: () => toast.success(tStop('lifted')) },
                    )
                  }
                >
                  <Play />
                  {tStop('resume')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem variant="destructive" onSelect={() => setStopping(true)}>
                  <OctagonX />
                  {tStop('stop')}
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSignOut}>
            <LogOut />
            {tCommon('signOut')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAbout(true)}>
            <Info />
            {t('about')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {stopping && <EmergencyStopDialog onClose={() => setStopping(false)} />}
      {about && <AboutHelenaDialog onClose={() => setAbout(false)} />}
    </>
  );
}
