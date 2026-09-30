'use client';

import { MatrixValue } from '@/design-system';
import type {
  MatrixColumn,
  MatrixRuntime,
  MatrixValues,
  SchemaCatalogModel,
} from '@/lib/api/endpoints/modelMatrix';
import { catalogLevels, catalogModels, catalogRuntimes } from '../utils/schemaEdit';
import type { MatrixLabels } from '../utils/labels';
import { ColumnCell } from './ColumnCell';

// One value of a role in a schema. A custom schema offers what the server accepts for it (its
// runtimes, the models of the runtime, the thinking levels of the model); a built-in one is
// only read.
export function SchemaRoleCell({
  column,
  values,
  staged,
  editable,
  catalog,
  labels,
  onChange,
  onReset,
}: {
  column: MatrixColumn;
  values: MatrixValues;
  staged: boolean;
  editable: boolean;
  catalog: SchemaCatalogModel[];
  labels: MatrixLabels;
  onChange: (value: MatrixValues[MatrixColumn]) => void;
  onReset: () => void;
}) {
  const value = values[column];
  if (!editable) {
    const { label, detail } = labels.parts(column, value);
    return <MatrixValue label={label} detail={detail} />;
  }
  const runtimes = catalogRuntimes(catalog);
  return (
    <ColumnCell
      column={column}
      value={value}
      source="schema"
      staged={staged}
      runtime={values.runtime}
      origin=""
      models={catalog.map(({ id, name }) => ({ id, name }))}
      labels={labels}
      scope="schema"
      limits={{
        runtimes: runtimes.includes(values.runtime as MatrixRuntime)
          ? runtimes
          : [values.runtime as MatrixRuntime, ...runtimes],
        models: catalogModels(catalog, values.runtime).map(({ id, name }) => ({ id, name })),
        reasoning: catalogLevels(catalog, values.runtime, values.model),
      }}
      onChange={onChange}
      onReset={onReset}
    />
  );
}
