import { describe, it, expect } from 'bun:test';
import { coordinatorSection, homeAgentSection } from '../../structure';

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

  it('names no manager when the coordinator reports to nobody', () => {
    const text = coordinatorSection({ projectKeys: ['MKT'], manager: null, specialists: [] });
    expect(text).toContain('You coordinate the agent team of MKT.');
  });
});
