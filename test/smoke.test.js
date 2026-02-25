const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = join(__dirname, '..', 'dist', 'index.js');

function run(args, cwd) {
  return execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
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
  require('node:fs').writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(pkgJson, null, 2) + '\n',
    'utf8',
  );

  run(['init'], dir);
  run(['sync'], dir);

  assert.ok(existsSync(join(dir, '.agentrules', 'rules.yaml')));
  assert.ok(existsSync(join(dir, 'CLAUDE.md')));
  assert.ok(existsSync(join(dir, 'AGENTS.md')));

  const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /npm run lint/);

  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /RULES_DOCTOR:BEGIN/);
  assert.match(agents, /RULES_DOCTOR:END/);
});

test('sync updates only the managed block in AGENTS.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-doctor-'));
  require('node:fs').writeFileSync(join(dir, 'package.json'), '{"name":"demo","private":true}\n');

  // Existing AGENTS.md with custom content.
  const agentsPath = join(dir, 'AGENTS.md');
  require('node:fs').writeFileSync(
    agentsPath,
    'Hello\n\n<!-- RULES_DOCTOR:BEGIN -->\nOLD\n<!-- RULES_DOCTOR:END -->\n\nFooter\n',
    'utf8',
  );

  run(['init'], dir);
  run(['sync', '--target', 'codex'], dir);

  const agents = readFileSync(agentsPath, 'utf8');
  assert.match(agents, /^Hello/m);
  assert.match(agents, /Footer/);
  assert.ok(!agents.includes('\nOLD\n'));
});
