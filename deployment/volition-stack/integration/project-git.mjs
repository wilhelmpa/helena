import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const IGNORE = '# Local credentials and generated dependencies\n.env\n.env.*\n!.env.example\n!.env.sample\n.secrets/\nsecrets/\ncredentials/\n*.pem\n*.key\nnode_modules/\n.next/\ndist/\n.venv/\nvenv/\n__pycache__/\n*.py[cod]\n.pytest_cache/\n.DS_Store\n';
const LOCAL_GIT_IDENTITY = Object.freeze({
  name: 'Volition Project Agent',
  email: 'agent@volition.invalid',
});
export async function ensureProjectGit(workspace) {
  const root = path.resolve(workspace.hostPath);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(root) !== root) throw new Error('Git workspace must be a real project-owned directory');
  try {
    const git = await fs.lstat(path.join(root, '.git'));
    if (git.isSymbolicLink() || (!git.isDirectory() && !git.isFile())) throw new Error('Git metadata must not be a link');
    return {created: false};
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await fs.writeFile(path.join(root, '.gitignore'), IGNORE, {flag: 'wx', mode: 0o640}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const options = {
    cwd: root, timeout: 15000, maxBuffer: 65536,
    env: {PATH: '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'},
  };
  await execute('/usr/bin/git', ['-c', 'init.templateDir=', '-c', 'core.hooksPath=/dev/null', 'init', '--initial-branch=main', '.'], options);
  await execute('/usr/bin/git', ['config', '--local', 'user.name', LOCAL_GIT_IDENTITY.name], options);
  await execute('/usr/bin/git', ['config', '--local', 'user.email', LOCAL_GIT_IDENTITY.email], options);
  return {created: true};
}
