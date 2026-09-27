import { redirect } from 'next/navigation';
import { notePath, notesPath } from '@/utils/paths';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectKey: string; boardId?: string }>;
  searchParams: Promise<{ canvas?: string }>;
}) {
  const { projectKey, boardId } = await params;
  const { canvas } = await searchParams;
  redirect(
    boardId
      ? notePath(projectKey, Number(boardId))
      : `${notesPath(projectKey)}${canvas ? `&canvas=${encodeURIComponent(canvas)}` : ''}`,
  );
}
