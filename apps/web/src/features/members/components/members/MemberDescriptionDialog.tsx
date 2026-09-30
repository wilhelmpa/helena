'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MemberRow } from '@/lib/api/endpoints/members';
import Avatar from '@/components/common/Avatar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSetMemberDescription } from '@/services/members.service';
import { Box, Inline, Stack, Text, TextArea } from '@/design-system';

// The "Edit" action for a member's project description: a button that opens a
// centered dialog with a textarea. A member edits their own; editing anyone else's
// needs the member permission (the API enforces it). Rendered in the member row's
// actions and in the team's project panel.
export default function MemberDescriptionDialog({
  projectKey,
  member,
  self,
}: {
  projectKey: string;
  member: Pick<MemberRow, 'userId' | 'name' | 'email' | 'image' | 'description'>;
  self: boolean;
}) {
  const t = useTranslations('members');
  const tCommon = useTranslations('common');
  const setDescription = useSetMemberDescription(projectKey);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(member.description);

  function openDialog() {
    setValue(member.description);
    setOpen(true);
  }

  async function save() {
    try {
      await setDescription.mutateAsync({ userId: member.userId, description: value.trim() });
      setOpen(false);
    } catch {
      // The failed mutation is toasted by the global handler; keep the dialog open.
    }
  }

  // "Role" is taken by the member's permission role in this same list, so the
  // question asks what the person does instead.
  const question = self ? t('descriptionQuestionSelf') : t('descriptionQuestionOther');
  const displayName = member.name || member.email;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={openDialog}
            aria-label={t('editDescription')}
          >
            <Pencil className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('editDescription')}</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent className="inset-0 top-0 left-0 h-screen w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-background p-0">
          <Box
            padX={4}
            padY={7}
            className="flex h-full w-full flex-col items-center justify-center"
          >
            <Stack gap={5} className="w-full max-w-2xl items-center">
              <Stack gap={4} className="items-center">
                <DialogTitle className="max-w-[32ch] text-center text-xl leading-tight font-medium tracking-tight text-balance text-foreground sm:text-3xl">
                  {question}
                </DialogTitle>
                <Inline gap={3} className="min-w-0">
                  <Avatar name={displayName} image={member.image} className="size-9 text-xs" />
                  <div className="flex min-w-0 flex-col">
                    <Text as="span" size="sm" className="truncate font-medium">
                      {displayName}
                    </Text>
                    <Text as="span" size="xs" tone="muted" className="truncate">
                      {member.email}
                    </Text>
                  </div>
                </Inline>
              </Stack>
              <Stack gap={4} className="w-full items-end">
                <TextArea
                  autoFocus
                  maxLength={500}
                  value={value}
                  placeholder={t('descriptionPlaceholder')}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
                  }}
                  className="min-h-40 w-full text-base leading-relaxed"
                />
                <Button
                  size="lg"
                  className="min-w-28"
                  onClick={save}
                  disabled={setDescription.isPending}
                >
                  {setDescription.isPending ? tCommon('saving') : tCommon('save')}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
}
