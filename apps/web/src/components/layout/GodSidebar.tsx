'use client';

import { usePathname } from 'next/navigation';
import { ArrowLeft, Plug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { godPath } from '@/utils/paths';
import { GOD_GROUPS, godIntegrationsIn, godSectionsIn } from '@/utils/godSections';
import { useGodSectionText } from '@/hooks/useSectionLabels';
import { useSidebarSide } from '@/hooks/useSidebarSide';
import { useAccountPreferences } from '@/services/preferences.service';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarNavSubmenu from '@/components/layout/SidebarNavSubmenu';
import SidebarAccountRow from '@/components/brand/SidebarAccountRow';
import SidebarBrand from '@/components/brand/SidebarBrand';

// The sidebar of the Administrator. It is the main sidebar's twin — the Helena brand
// row, then a way back and the instance sections in groups, the integration sections
// folded into one item, the account row at the foot — so leaving the app for the
// Administrator changes the list, not the look.
export default function GodSidebar() {
  const t = useTranslations('nav');
  const god = useGodSectionText();
  const pathname = usePathname();
  const side = useSidebarSide();
  const { headerLayout } = useAccountPreferences();

  return (
    <Sidebar collapsible="icon" side={side}>
      {/* The same 48px brand row as the main sidebar (AppSidebar): the header's
          breadcrumb already says "Administrator", so no second badge here. */}
      <SidebarHeader className="h-12 shrink-0 justify-center px-2 py-0">
        <SidebarBrand />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarNavItem
                href="/"
                icon={ArrowLeft}
                label={t('backToApp')}
                active={false}
                disabled={false}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {GOD_GROUPS.map((group) => {
          const integrations = godIntegrationsIn(group).map((section) => ({
            key: section.slug,
            href: godPath(section.slug),
            icon: section.icon,
            label: god.section(section.slug).label,
            active: pathname.startsWith(`/god/${section.slug}`),
          }));
          return (
            <SidebarGroup key={group}>
              <SidebarGroupLabel>{god.group(group)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {godSectionsIn(group).map((section) => (
                    <SidebarNavItem
                      key={section.slug}
                      href={godPath(section.slug)}
                      icon={section.icon}
                      label={god.section(section.slug).label}
                      active={pathname.startsWith(`/god/${section.slug}`)}
                      disabled={false}
                    />
                  ))}
                  {integrations.length > 0 && (
                    <SidebarNavSubmenu icon={Plug} label={t('integrations')} items={integrations} />
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        {headerLayout === 'single' && (
          <>
            <SidebarSeparator />
            <SidebarAccountRow />
          </>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
