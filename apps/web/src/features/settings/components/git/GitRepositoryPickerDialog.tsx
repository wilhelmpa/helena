import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { GitProviderConnection } from '@/lib/api/endpoints/git';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  useAvailableGitRepositoriesQuery,
  useConnectGitRepositories,
} from '../../services/settings.service';

import { Inline, Box, Text, Card } from '@/design-system';

export default function GitRepositoryPickerDialog({
  projectKey,
  connection,
  open,
  onOpenChange,
}: {
  projectKey: string;
  connection: GitProviderConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('settings.git');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const repositoriesQuery = useAvailableGitRepositoriesQuery(
    projectKey,
    connection.id,
    debouncedSearch,
    open,
  );
  const connect = useConnectGitRepositories(projectKey, connection.id);
  const repositories = useMemo(
    () => repositoriesQuery.data?.pages.flatMap((page) => page.repositories) ?? [],
    [repositoriesQuery.data],
  );

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelected(new Set());
    }
  }, [open]);

  function toggle(externalId: string, checked: boolean) {
    setSelected((current) => {
      if (checked && current.size >= 50) {
        toast.error(t('nativeRepositoryLimit'));
        return current;
      }
      const next = new Set(current);
      if (checked) next.add(externalId);
      else next.delete(externalId);
      return next;
    });
  }

  async function submit() {
    try {
      await connect.mutateAsync([...selected]);
      toast.success(t('nativeRepositoriesConnected', { count: selected.size }));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('nativeRepositoryConnectFailed'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="large">
        <DialogHeader>
          <DialogTitle>{t('nativeChooseRepositories')}</DialogTitle>
          <DialogDescription>
            {t('nativeChooseRepositoriesHint', { account: connection.accountLogin })}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('nativeSearchRepositories')}
        />
        <Card tone="inset" pad="tight" gap={1} className="max-h-80 overflow-y-auto">
          {repositoriesQuery.isPending && (
            <Box as="p" pad={3}>
              <Text as="span" size="sm" tone="muted">
                {t('nativeLoadingRepositories')}
              </Text>
            </Box>
          )}
          {!repositoriesQuery.isPending && repositories.length === 0 && (
            <Box as="p" pad={3}>
              <Text as="span" size="sm" tone="muted">
                {t('nativeNoRepositories')}
              </Text>
            </Box>
          )}
          {repositories.map((repository) => {
            const connected = repository.managedRepositoryId !== null;
            return (
              <Inline
                as="label"
                gap={3}
                padX={3}
                padY={2}
                key={repository.externalId}
                className="flex cursor-pointer items-center rounded-md hover:bg-muted/60"
              >
                <Checkbox
                  checked={connected || selected.has(repository.externalId)}
                  disabled={connected}
                  onCheckedChange={(value) => toggle(repository.externalId, value === true)}
                />
                <Text as="span" size="sm" className="min-w-0 flex-1 truncate">
                  {repository.fullName}
                </Text>
                <Text as="span" size="xs" tone="muted">
                  {connected
                    ? t('nativeAlreadyConnected')
                    : repository.private
                      ? t('nativePrivate')
                      : t('nativePublic')}
                </Text>
              </Inline>
            );
          })}
          {repositoriesQuery.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={repositoriesQuery.isFetchingNextPage}
              onClick={() => void repositoriesQuery.fetchNextPage()}
            >
              {t('nativeLoadMore')}
            </Button>
          )}
        </Card>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('nativeCancel')}
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0 || connect.isPending}
            onClick={() => void submit()}
          >
            {connect.isPending
              ? t('nativeConnecting')
              : t('nativeConnectSelected', { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
