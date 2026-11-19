/**
 * Minimal Node I/O for evaluation specs that write reports. The spec tsconfig has no Node
 * typings (specs run against browser APIs), so the few calls needed are typed here and
 * `node:fs` is imported at run time only.
 */
interface NodeProcess {
  readonly env: Readonly<Record<string, string | undefined>>;
  cwd(): string;
}

interface NodeFs {
  writeFileSync(path: string, data: string): void;
}

const nodeProcess = (globalThis as { process?: NodeProcess }).process;

export function environmentVariable(name: string): string | undefined {
  return nodeProcess?.env[name];
}

/** Writes a text file relative to the repository root (the test runner's cwd). */
export async function writeRepositoryFile(relativePath: string, content: string): Promise<void> {
  if (!nodeProcess) throw new Error('writeRepositoryFile needs Node');
  const specifier = 'node:fs';
  const fs = (await import(/* @vite-ignore */ specifier)) as NodeFs;
  fs.writeFileSync(`${nodeProcess.cwd()}/${relativePath}`, content);
}
