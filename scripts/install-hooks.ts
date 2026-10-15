import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

if (!process.env.CI && existsSync(new URL('../.git', import.meta.url))) {
  const configured = Bun.spawnSync(['git', 'config', '--get', 'core.hooksPath'], { cwd: root });
  if (configured.exitCode !== 0 && configured.exitCode !== 1) {
    throw new Error(configured.stderr.toString() || 'Could not read Git hooks configuration.');
  }
  const hooksPath = configured.stdout.toString().trim();
  if (hooksPath && hooksPath !== '.githooks') {
    console.warn(
      `Keeping existing Git hooks at ${hooksPath}. Add "bun run check" to your pre-push hook.`,
    );
  } else {
    const installed = Bun.spawnSync(['git', 'config', '--local', 'core.hooksPath', '.githooks'], {
      cwd: root,
    });
    if (installed.exitCode !== 0) {
      throw new Error(installed.stderr.toString() || 'Could not install the pre-push hook.');
    }
    console.info('Noble Gas: pre-push checks installed.');
  }
}
