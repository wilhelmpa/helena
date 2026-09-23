import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { usePermissions } from '@/hooks/usePermissions';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import {
  useProjectSetupQuery,
  useRetryProjectDeprovisioning,
  useRetryProjectProvisioning,
} from '../../services/settings.service';
import SettingsSetupJobRow from './SettingsSetupJobRow';

// The Setup block of the General page: the state of the job that sets the project's
// resources up, and of the cleanup of an earlier deleted project with the same key.
// The provisioning retry is open to whoever governs the project, the cleanup retry
// to an owner or manager of the team, as on the API.
export default function SettingsSetup({ project }: { project: ProjectDetail }) {
  const t = useTranslations('settings.general.setup');
  const { key, teamId } = project.project;
  const { isAdmin } = usePermissions();
  const runsTeam = project.viewer.teamRole === 'owner' || project.viewer.teamRole === 'manager';
  const setup = useProjectSetupQuery(key);
  const retryProvisioning = useRetryProjectProvisioning(key);
  const retryCleanup = useRetryProjectDeprovisioning(key, teamId);

  return (
    <SettingsSection title={t('title')} description={t('description')}>
      <SettingsCard className="divide-y divide-border/60">
        {setup.isError ? (
          <p className="p-4 text-xs text-destructive">{t('unavailable')}</p>
        ) : setup.data ? (
          <>
            <SettingsSetupJobRow
              title={t('provisioning')}
              description={t('provisioningHint')}
              job={setup.data.provisioning}
              canRetry={isAdmin}
              retrying={retryProvisioning.isPending}
              onRetry={() => retryProvisioning.mutate()}
            />
            {setup.data.deprovisioning && (
              <SettingsSetupJobRow
                title={t('cleanup')}
                description={t('cleanupHint')}
                job={setup.data.deprovisioning}
                canRetry={runsTeam}
                retrying={retryCleanup.isPending}
                onRetry={() => retryCleanup.mutate(setup.data.deprovisioning!.id)}
              />
            )}
          </>
        ) : (
          <p className="p-4 text-xs text-muted-foreground">{t('loading')}</p>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
