import { createColumn, listColumns } from '../src/modules/columns/service';
import { getProjectByKey } from '../src/modules/projects/service';

const keys = process.argv.slice(2);
if (keys.length === 0) throw new Error('Pass at least one project key');

for (const key of keys) {
  const project = await getProjectByKey(key);
  if (!project) throw new Error(`Project ${key} was not found`);
  const columns = await listColumns(project.id);
  if (columns.some((column) => column.name.trim().toLowerCase() === 'review')) {
    console.log(`${key}: present`);
    continue;
  }
  await createColumn({
    projectId: project.id,
    name: 'Review',
    stateType: 'started',
    color: '#8b5cf6',
  });
  console.log(`${key}: created`);
}

process.exit(0);
