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
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
}

const nodeProcess = (globalThis as { process?: NodeProcess }).process;

export function environmentVariable(name: string): string | undefined {
  return nodeProcess?.env[name];
}

async function nodeFs(): Promise<NodeFs> {
  if (!nodeProcess) throw new Error('repository file access needs Node');
  const specifier = 'node:fs';
  return (await import(/* @vite-ignore */ specifier)) as NodeFs;
}

function repositoryPath(relativePath: string): string {
  return `${(nodeProcess as NodeProcess).cwd()}/${relativePath}`;
}

/** Writes a text file relative to the repository root (the test runner's cwd). */
export async function writeRepositoryFile(relativePath: string, content: string): Promise<void> {
  const fs = await nodeFs();
  const path = repositoryPath(relativePath);
  fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(path, content);
}

/** Reads a text file relative to the repository root; undefined when it does not exist. */
export async function readRepositoryFile(relativePath: string): Promise<string | undefined> {
  const fs = await nodeFs();
  const path = repositoryPath(relativePath);
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : undefined;
}
