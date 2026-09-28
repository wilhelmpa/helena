import HomeFilesPage from '@/features/project-files/HomeFilesPage';

// Home → Wissen. A Markdown file opens in the page's own editor (no redirect: the note
// path of a Home file is this very page, so a redirect here looped forever).
export default function Files() {
  return <HomeFilesPage />;
}
