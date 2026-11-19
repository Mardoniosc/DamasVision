// Regenerates docs/vision/recognition-metrics.md from the real labeled samples (G3).
// Cross-platform: sets RECOGNITION_REPORT for the metrics spec, runs it once, then
// formats the generated report so `npm run format:check` stays green.
import { spawnSync } from 'node:child_process';

const run = (args, env = process.env) =>
  spawnSync('npx', args, { stdio: 'inherit', shell: true, env }).status ?? 1;

const status = run(
  ['ng', 'test', '--watch=false', '--include=../tests/integration/recognition-metrics.spec.ts'],
  { ...process.env, RECOGNITION_REPORT: '1' },
);
if (status !== 0) process.exit(status);
process.exit(run(['prettier', '--write', 'docs/vision/recognition-metrics.md']));
