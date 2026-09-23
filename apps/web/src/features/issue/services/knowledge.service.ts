// The notes of the knowledge vault that link to a task with [[KEY-n]], and a new note
// that does.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/core/client';
import { listTaskNotes, writeNote } from '@/lib/api/endpoints/knowledge';
import { qk } from '@/services/queryKeys';
import { taskNotePath } from '../utils/taskNote';

export function useTaskNotesQuery(identifier: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.knowledgeTaskNotes(identifier),
    queryFn: () => listTaskNotes(identifier),
    enabled,
  });
}

// Creates "<identifier> <title>.md" in the project's Docs with a link to the task, and
// answers with its path. A note of that name that exists already is opened instead.
export function useCreateTaskNote(projectKey: string, identifier: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      const path = taskNotePath(projectKey, identifier, title);
      try {
        await writeNote({
          path,
          body: `# ${identifier} ${title}\n\n[[${identifier}]]\n`,
          frontmatter: {},
          expectedSha: null,
        });
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'exists')) throw error;
      }
      return path;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.knowledgeTaskNotes(identifier) }),
  });
}
