'use client';

import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Send, Trash2, X } from 'lucide-react';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setComposeDraft, takeFreshDraft } from '@/hooks/useMailCompose';
import type { MailDraft } from '@/lib/api/endpoints/mail';
import { useDraftAutosave } from '../hooks/useDraftAutosave';
import { useDiscardDraft, useSendDraft, useUndoDraft } from '../services/drafts.service';
import ComposeAttachments from './ComposeAttachments';
import ComposeFrom from './ComposeFrom';
import ComposeStatus from './ComposeStatus';
import RecipientField from './RecipientField';

// Writing one draft: it is saved a second after each change, and sending gives ten
// seconds to take it back.
export default function ComposeEditor({ draft }: { draft: MailDraft }) {
  const t = useTranslations('mail.compose');
  const editorRef = useRef<Editor | null>(null);
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCopies, setShowCopies] = useState(draft.cc.length + draft.bcc.length > 0);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.bodyText);
  const editable = draft.status === 'draft' || draft.status === 'failed';
  const values = { to, cc, bcc, subject, bodyText: body };
  const autosave = useDraftAutosave(
    draft.id,
    values,
    () => editorRef.current?.getHTML() ?? '',
    editable,
  );
  const send = useSendDraft();
  const undo = useUndoDraft();
  const discard = useDiscardDraft(draft.teamId);

  const submit = async () => {
    if (!editable || send.isPending) return;
    await autosave.flush();
    const queued = await send.mutateAsync(draft.id);
    setComposeDraft(null);
    toast(t('sending'), {
      duration: 10_000,
      action: {
        label: t('undo'),
        onClick: () =>
          undo.mutate(queued.id, {
            onSuccess: () => setComposeDraft(queued.id),
            onError: () => toast.error(t('tooLate')),
          }),
      },
    });
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <span className="flex-1 truncate text-sm font-medium">{subject || t('newMail')}</span>
        <span className="text-xs text-muted-foreground">{autosave.saving ? t('saving') : ''}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          title={t('close')}
          aria-label={t('close')}
          onClick={() => void autosave.flush().then(() => setComposeDraft(null))}
        >
          <X />
        </Button>
      </div>
      <ComposeStatus draft={draft} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <ComposeFrom draft={draft} editable={editable} />
        <RecipientField
          teamId={draft.teamId}
          label={t('to')}
          value={to}
          onChange={setTo}
          disabled={!editable}
        />
        {showCopies ? (
          <>
            <RecipientField
              teamId={draft.teamId}
              label={t('cc')}
              value={cc}
              onChange={setCc}
              disabled={!editable}
            />
            <RecipientField
              teamId={draft.teamId}
              label={t('bcc')}
              value={bcc}
              onChange={setBcc}
              disabled={!editable}
            />
          </>
        ) : (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground hover:underline"
            onClick={() => setShowCopies(true)}
          >
            {t('addCopies')}
          </button>
        )}
        <Input
          value={subject}
          disabled={!editable}
          onChange={(event) => setSubject(event.target.value)}
          placeholder={t('subject')}
          aria-label={t('subject')}
        />
        <div className="min-h-48 flex-1 rounded-md border px-3 py-2">
          <MarkdownEditor
            defaultValue={draft.bodyText}
            editable={editable}
            onChange={setBody}
            onReady={(editor) => {
              editorRef.current = editor;
              if (editor && takeFreshDraft(draft.id)) {
                if (draft.bodyText) editor.chain().insertContentAt(0, '<p></p>').run();
                editor.commands.focus('start');
              }
            }}
            placeholder={t('bodyPlaceholder')}
          />
        </div>
        <ComposeAttachments draft={draft} editable={editable} />
      </div>
      {editable && (
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={send.isPending}
            title={t('sendHint')}
          >
            <Send />
            {t('send')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="ms-auto"
            disabled={discard.isPending}
            onClick={() => discard.mutate(draft.id, { onSuccess: () => setComposeDraft(null) })}
          >
            <Trash2 />
            {t('discard')}
          </Button>
        </div>
      )}
    </div>
  );
}
