import { describe, it, expect } from 'bun:test';
import { coordinatorSection, homeAgentSection, memberSection } from '../../structure';

describe('homeAgentSection', () => {
  it('names the coordinator of each project', () => {
    const text = homeAgentSection([
      { key: 'MKT', name: 'Marketing', coordinators: ['hermes-mkt-coordinator'] },
      { key: 'OPS', name: 'Ops', coordinators: [] },
    ]);
    expect(text).toContain('- MKT — "Marketing": @hermes-mkt-coordinator');
    expect(text).toContain('- OPS — "Ops": no coordinator');
  });

  it('leaves the project list out when the Home agent works in none', () => {
    expect(homeAgentSection([])).not.toContain('Each project is led');
  });
});

describe('coordinatorSection', () => {
  it('names the Home agent as the manager and lists the specialists', () => {
    const text = coordinatorSection({
      projectKeys: ['MKT'],
      manager: 'master',
      managerIsHome: true,
      specialists: ['writer', 'designer-mkt'],
    });
    expect(text).toContain('of MKT and report to the Home agent (@master).');
    expect(text).toContain('instead: @writer, @designer-mkt.');
  });

  it('names another manager by handle and says when there is no specialist', () => {
    const text = coordinatorSection({ projectKeys: ['MKT'], manager: 'lead', specialists: [] });
    expect(text).toContain('of MKT and report to @lead.');
    expect(text).toContain('the project has none yet.');
  });

  it('offers the sub-agents of its own runtime', () => {
    const input = { projectKeys: ['MKT'], manager: null, specialists: [] };
    expect(coordinatorSection(input)).toContain('Hermes sub-agents with the delegation');
    const claude = coordinatorSection({ ...input, runtime: 'claude' });
    expect(claude).toContain('Claude Code subagents with the Task tool');
    expect(claude).not.toContain('Hermes');
    const codex = coordinatorSection({ ...input, runtime: 'codex' });
    expect(codex).not.toContain('sub-agents');
    expect(codex).not.toContain('Hermes');
  });

  it('names no manager when the coordinator reports to nobody', () => {
    const text = coordinatorSection({ projectKeys: ['MKT'], manager: null, specialists: [] });
    expect(text).toContain('You coordinate the agent team of MKT.');
  });
});

describe('memberSection', () => {
  const base = {
    role: 'specialist' as const,
    projectKeys: ['VOL'],
    manager: 'hermes-vol-coordinator',
    coordinators: ['hermes-vol-coordinator'],
    peers: [{ username: 'content-vol', capabilities: ['content', 'seo'] }],
  };

  it('names the coordinator a specialist reports to and how it hands work back', () => {
    const text = memberSection(base);
    expect(text).toStartWith('## Agent team');
    expect(text).toContain(
      'You are a specialist in the agent team of VOL and report to @hermes-vol-coordinator.',
    );
    expect(text).toContain('@content-vol (content, seo)');
    expect(text).toContain('answer with exactly the JSON the stage asks for');
    expect(text).toContain('add_comment');
    expect(text).toContain('request_approval');
    expect(text).toContain('mark_issue_blocked');
  });

  it("falls back to the project's coordinators when the chart names no manager", () => {
    const text = memberSection({ ...base, manager: null, coordinators: ['a', 'b'] });
    expect(text).toContain('and report to @a, @b.');
  });

  it('names the Home agent as such and words a reviewer', () => {
    const text = memberSection({
      ...base,
      role: 'reviewer',
      manager: 'master',
      managerIsHome: true,
      peers: [],
    });
    expect(text).toContain('You review the work of the agent team of VOL');
    expect(text).toContain('report to the Home agent (@master)');
    expect(text).not.toContain("team's other members");
  });

  it('says whom to tag when nobody leads the team', () => {
    const text = memberSection({ ...base, manager: null, coordinators: [] });
    expect(text).toContain("Your work comes from the project's owners");
    expect(text).toContain('Tag the person who gave you the task');
  });
});
