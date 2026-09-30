import { describe, expect, it } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { inspectMcpPackage, inspectSkillFiles, inspectionPasses, unpackTarGz } from '../inspection';

const license = Buffer.from(
  'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy',
);
const skill = Buffer.from(
  '---\nname: fixture-skill\ndescription: A fixture for scanning.\n---\n\nUse this reference.\n',
);

describe('curated catalog inspection with local fixtures', () => {
  it('pins every inspected skill byte and lists executable scripts without importing them', () => {
    const result = inspectSkillFiles([
      { path: 'SKILL.md', bytes: skill },
      { path: 'LICENSE', bytes: license },
      { path: 'scripts/check.sh', bytes: Buffer.from('#!/bin/sh\ncurl https://example.org\n') },
    ]);
    expect(result.license).toBe('MIT');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.snapshot.files).toHaveLength(3);
    expect(result.findings.map((finding) => finding.code)).toContain('executable');
    expect(result.findings.map((finding) => finding.code)).toContain('network-shell');
    expect(inspectionPasses(result.findings)).toBe(true);
  });

  it('blocks an unknown license and a secret in a skill', () => {
    const result = inspectSkillFiles([
      { path: 'SKILL.md', bytes: Buffer.concat([skill, Buffer.from('AKIAABCDEFGHIJKLMNOP')]) },
    ]);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['license', 'secret']),
    );
    expect(inspectionPasses(result.findings)).toBe(false);
    expect(result.snapshot.files[0].content).toBe('');
    expect(result.snapshot.markdown).toContain('redacted');
  });

  it('reads a local tar fixture and flags executable package content', () => {
    const content = Buffer.from('#!/bin/sh\nwget https://example.org/agent\n');
    const header = Buffer.alloc(512);
    header.write('package/bin/server.sh', 0, 'utf8');
    header.write('0000755\0', 100, 'ascii');
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    header.write('0', 156, 'ascii');
    const archive = gzipSync(
      Buffer.concat([header, content, Buffer.alloc(512 - content.length), Buffer.alloc(1024)]),
    );
    const files = unpackTarGz(archive);
    expect(files).toHaveLength(1);
    const result = inspectMcpPackage({
      name: 'fixture-mcp',
      version: '1.2.3',
      license: 'MIT',
      integrity: 'sha512-test',
      files,
    });
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['executable', 'network-shell']),
    );
    expect(result.snapshot.files[0].size).toBe(content.length);
  });

  it('blocks an MCP package with uninspected runtime dependencies', () => {
    const result = inspectMcpPackage({
      name: 'fixture-mcp',
      version: '1.2.3',
      license: 'MIT',
      integrity: 'sha512-test',
      dependencies: ['moving-package'],
    });
    expect(result.findings.map((finding) => finding.code)).toContain('unscanned-dependencies');
    expect(inspectionPasses(result.findings)).toBe(false);
  });
});
