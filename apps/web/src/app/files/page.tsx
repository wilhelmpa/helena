import HomeFilesPage from '@/features/project-files/HomeFilesPage';
import { redirect } from 'next/navigation';
import { vaultNotePath } from '@/utils/paths';

export default async function Files({
  searchParams,
}: {
  searchParams: Promise<{ root?: string; project?: string; file?: string; source?: string }>;
}) {
  const { root, project, file, source } = await searchParams;
  if (file && /\.md$/i.test(file) && source !== '1') {
    const base =
      root === 'project' && project
        ? `Projects/${project}`
        : root === 'private'
          ? 'Private'
          : root === 'templates'
            ? 'Templates'
            : 'Home';
    redirect(vaultNotePath(`${base}/${file}`));
  }
  return <HomeFilesPage />;
}
