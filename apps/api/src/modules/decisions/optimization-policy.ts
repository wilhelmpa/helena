import { classSetting, type DecideRequest } from './service';

export type OptimizationScope = Pick<DecideRequest, 'teamId' | 'projectId' | 'agentId'>;

// TODO(Claude/121b): resolve agent/project matrix overrides here when the matrix API exists.
export async function optimizationEnabled(
  scope: OptimizationScope,
  classId: string,
): Promise<boolean> {
  return (await classSetting(scope.teamId, classId)).enabled;
}
