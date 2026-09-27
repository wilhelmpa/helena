'use client';

import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ImagePlus, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { insertDocumentImage } from '@/components/common/editor/DocumentMarkdownEditor';

export default function DocumentImageMenu({
  editor,
  onUpload,
}: {
  editor: Editor;
  onUpload: (file: File) => Promise<{ url: string; filename: string }>;
}) {
  const t = useTranslations('documents.toolbar');
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const insert = (source: string, alt?: string) => {
    if (!insertDocumentImage(editor, editor.isEditable, source, alt)) return;
    setUrl('');
    setOpen(false);
  };

  const upload = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const asset = await onUpload(file);
      insert(asset.url, asset.filename);
    } catch {
      // The failed upload is toasted by the shared mutation handler.
    } finally {
      setUploading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('image')}
        >
          <ImagePlus className="size-4 stroke-[1.75]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[21rem] space-y-3 rounded-xl p-3 shadow-xl">
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          accept="image/*"
          aria-label={t('uploadImage')}
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-full rounded-lg border-dashed bg-muted/20 text-xs shadow-none"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {t('uploadImage')}
        </Button>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            insert(url);
          }}
        >
          <Input
            value={url}
            type="url"
            dir="ltr"
            className="h-9 rounded-lg text-xs"
            placeholder={t('imageUrl')}
            aria-label={t('imageUrl')}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button type="submit" size="sm" className="h-9 rounded-lg" disabled={!url.trim()}>
            {t('insert')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
