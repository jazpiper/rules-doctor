const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runCli } = require('../src/index.js');

function run(args, cwd) {
  const out = [];
  const err = [];
  const exitCode = runCli(args, {
    cwd,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return {
    exitCode,
    stdout: out.join('\n'),
    stderr: err.join('\n'),
  };
}

test('init + sync creates rules.yaml, CLAUDE.md, and AGENTS.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-doctor-'));

  // Provide scripts to infer.
  const pkgJson = {
    name: 'demo',
    private: true,
    scripts: {
      lint: 'echo lint',
      test: 'echo test',
      build: 'echo build',
    },
  };
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(pkgJson, null, 2) + '\n',
    'utf8',
  );

  const init = run(['init'], dir);
  assert.equal(init.exitCode, 0);

  const sync = run(['sync'], dir);
  assert.equal(sync.exitCode, 0);

  assert.ok(existsSync(join(dir, '.agentrules', 'rules.yaml')));
  assert.ok(existsSync(join(dir, 'CLAUDE.md')));
  assert.ok(existsSync(join(dir, 'AGENTS.md')));
  assert.ok(existsSync(join(dir, '.cursor', 'rules', 'rules-doctor.mdc')));
  assert.ok(existsSync(join(dir, 'GEMINI.md')));

  const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /npm run lint/);

  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /RULES_DOCTOR:BEGIN/);
  assert.match(agents, /RULES_DOCTOR:END/);
});

test('sync updates only the managed block in AGENTS.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-doctor-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"demo","private":true}\n');

  // Existing AGENTS.md with custom content.
  const agentsPath = join(dir, 'AGENTS.md');
  writeFileSync(
    agentsPath,
    'Hello\n\n<!-- RULES_DOCTOR:BEGIN -->\nOLD\n<!-- RULES_DOCTOR:END -->\n\nFooter\n',
    'utf8',
  );

  assert.equal(run(['init'], dir).exitCode, 0);
  assert.equal(run(['sync', '--target', 'codex'], dir).exitCode, 0);

  const agents = readFileSync(agentsPath, 'utf8');
  assert.match(agents, /^Hello/m);
  assert.match(agents, /Footer/);
  assert.ok(!agents.includes('\nOLD\n'));
});

test('targets list includes representative CLI adapters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-doctor-'));
  const result = run(['targets', 'list'], dir);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /claude/);
  assert.match(result.stdout, /codex/);
  assert.match(result.stdout, /cursor/);
  assert.match(result.stdout, /gemini/);
  assert.match(result.stdout, /opencode/);
  assert.match(result.stdout, /antigravity/);
});

test('running in subdirectory still writes to project root', () => {
  const root = mkdtempSync(join(tmpdir(), 'rules-doctor-'));
  const subdir = join(root, 'apps', 'web');
  mkdirSync(subdir, { recursive: true });
  mkdirSync(join(root, '.git'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'demo', private: true, scripts: { lint: 'echo lint' } }) + '\n',
    'utf8',
  );

  assert.equal(run(['init'], subdir).exitCode, 0);
  assert.equal(run(['sync', '--target', 'cursor'], subdir).exitCode, 0);

  assert.ok(existsSync(join(root, '.agentrules', 'rules.yaml')));
  assert.ok(existsSync(join(root, '.cursor', 'rules', 'rules-doctor.mdc')));
  assert.ok(!existsSync(join(subdir, '.agentrules', 'rules.yaml')));
});
