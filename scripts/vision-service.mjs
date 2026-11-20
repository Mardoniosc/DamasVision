// Optional local vision service (G3.1, ADR-042): setup, serve, test, contract export.
// Cross-platform (Windows and POSIX); Node built-ins only.
//
//   node scripts/vision-service.mjs setup     create vision-service/.venv, install the exact pins
//   node scripts/vision-service.mjs serve     run the service on 127.0.0.1:8765
//   node scripts/vision-service.mjs contract  export the browser fixtures the service is checked against
//   node scripts/vision-service.mjs test      contract export, then pytest
//   node scripts/vision-service.mjs eval      metrics report (docs/vision/service-metrics.md)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const service = join(root, 'vision-service');
const windows = process.platform === 'win32';
const venvPython = join(service, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function findPython() {
  for (const [command, args] of [
    ['py', ['-3']],
    ['python3', []],
    ['python', []],
  ]) {
    const probe = spawnSync(command, [...args, '--version'], { encoding: 'utf8' });
    if (probe.status === 0 && /Python 3\.(1[1-3])/.test(`${probe.stdout}${probe.stderr}`)) {
      return [command, args];
    }
  }
  return null;
}

function requireVenv() {
  if (!existsSync(venvPython)) {
    console.error('vision-service/.venv not found: run `npm run vision:setup` first.');
    process.exit(1);
  }
}

const env = { ...process.env, PYTHONPATH: join(service, 'src') };
const commands = {
  setup() {
    const python = findPython();
    if (!python) {
      console.error('Python 3.11–3.13 is required (see vision-service/README.md).');
      return 1;
    }
    const [command, args] = python;
    if (!existsSync(venvPython)) {
      const status = run(command, [...args, '-m', 'venv', join(service, '.venv')]);
      if (status !== 0) return status;
    }
    return run(venvPython, ['-m', 'pip', 'install', '-r', join(service, 'requirements.lock')]);
  },
  serve() {
    requireVenv();
    return run(venvPython, ['-m', 'damas_vision_service'], { env, cwd: service });
  },
  contract() {
    return run(
      'npx',
      [
        'ng',
        'test',
        '--watch=false',
        '--include=../tests/integration/vision-service-contract.spec.ts',
      ],
      { shell: true, cwd: root, env: { ...process.env, CONTRACT_EXPORT: '1' } },
    );
  },
  eval() {
    requireVenv();
    const status = run(venvPython, [join(service, 'scripts', 'evaluate.py')], { env, cwd: root });
    if (status !== 0) return status;
    return run('npx', ['prettier', '--write', 'docs/vision/service-metrics.md'], {
      shell: true,
      cwd: root,
    });
  },
  test() {
    requireVenv();
    const exported = commands.contract();
    if (exported !== 0) return exported;
    return run(venvPython, ['-m', 'pytest', ...process.argv.slice(3)], { env, cwd: service });
  },
};

const name = process.argv[2];
if (!(name in commands)) {
  console.error(`usage: node scripts/vision-service.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
process.exit(commands[name]());
