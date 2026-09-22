'use client';

import { Cpu, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AgentFormValue } from '../../utils/agentForm';
import { AgentFormSection } from './AgentFormSection';

const REASONING = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

function lines(value: string) {
  return value.split(/\r?\n/);
}

export default function AgentRuntimePolicySection({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
}) {
  const policy = value.runtimePolicy;
  const patchPolicy = (patch: Partial<typeof policy>) =>
    onChange({ runtimePolicy: { ...policy, ...patch } });

  return (
    <AgentFormSection
      open={open}
      onOpenChange={onOpenChange}
      icon={Cpu}
      title="Runtime policy"
      hint="Runtime-neutral policy applied by the connected adapter"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="agent-runtime-model" className="text-sm font-medium">
            Model
          </label>
          <Input
            id="agent-runtime-model"
            placeholder="provider/model"
            value={value.model}
            onChange={(event) => onChange({ model: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Reasoning</span>
          <div className="flex flex-wrap gap-1.5">
            {REASONING.map((effort) => (
              <Button
                key={effort}
                type="button"
                size="sm"
                variant={policy.reasoningEffort === effort ? 'secondary' : 'outline'}
                onClick={() => patchPolicy({ reasoningEffort: effort })}
              >
                {effort}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <label className="flex items-start gap-2">
        <Checkbox
          className="mt-0.5"
          checked={value.memoryEnabled}
          onCheckedChange={(checked) => onChange({ memoryEnabled: checked === true })}
        />
        <span className="text-sm font-medium">Conversation memory</span>
      </label>
      {value.memoryEnabled && (
        <Input
          type="number"
          min="1"
          aria-label="Memory message window"
          placeholder="Recent message window"
          value={value.memoryLastMessages}
          onChange={(event) => onChange({ memoryLastMessages: event.target.value })}
        />
      )}

      {(
        [
          ['toolAllow', 'Allowed tools'],
          ['toolDeny', 'Denied tools'],
          ['mcpGrants', 'MCP grants'],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="space-y-1.5">
          <label htmlFor={`runtime-${key}`} className="text-sm font-medium">
            {label}
          </label>
          <Textarea
            id={`runtime-${key}`}
            rows={2}
            placeholder="One key per line"
            value={policy[key].join('\n')}
            onChange={(event) => patchPolicy({ [key]: lines(event.target.value) })}
          />
        </div>
      ))}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Managed Markdown files</p>
            <p className="text-xs text-muted-foreground">
              Instruction and memory files, synced by the runtime adapter.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              patchPolicy({
                files: [...policy.files, { kind: 'instructions', path: '', content: '' }],
              })
            }
          >
            <Plus className="me-1 size-3.5" /> Add file
          </Button>
        </div>
        {policy.files.map((file, index) => (
          <div key={`${index}-${file.path}`} className="space-y-2 rounded-md border p-3">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const files = [...policy.files];
                  files[index] = {
                    ...file,
                    kind: file.kind === 'instructions' ? 'memory' : 'instructions',
                  };
                  patchPolicy({ files });
                }}
              >
                {file.kind}
              </Button>
              <Input
                aria-label={`Managed file ${index + 1} path`}
                placeholder={file.kind === 'memory' ? 'memory/topic.md' : 'AGENTS.md'}
                value={file.path}
                onChange={(event) => {
                  const files = [...policy.files];
                  files[index] = { ...file, path: event.target.value };
                  patchPolicy({ files });
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove managed file ${index + 1}`}
                onClick={() => patchPolicy({ files: policy.files.filter((_, i) => i !== index) })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Textarea
              rows={6}
              aria-label={`Managed file ${index + 1} content`}
              value={file.content}
              onChange={(event) => {
                const files = [...policy.files];
                files[index] = { ...file, content: event.target.value };
                patchPolicy({ files });
              }}
            />
          </div>
        ))}
      </div>
    </AgentFormSection>
  );
}
