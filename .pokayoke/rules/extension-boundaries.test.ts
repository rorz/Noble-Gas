import { expect, test } from 'bun:test';
import { parseTypescriptSource } from 'pokayoke';
import { extensionBoundaries } from './extension-boundaries.rule';

async function check(file: string, text: string) {
  return extensionBoundaries.run({
    root: process.cwd(),
    fix: false,
    options: undefined,
    files: async () => [file],
    glob: async () => [file],
    readFile: async () => text,
    parseTypescript: async () => parseTypescriptSource(file, text),
    packageJson: async () => ({}),
    workspaces: async () => [],
    report: () => {},
  });
}
test('model SDKs may only be imported by the worker', async () => {
  expect(
    (await check('src/background/gateway.ts', 'import { streamText } from "ai"')).findings,
  ).toHaveLength(0);
  expect(
    (await check('src/content/editor.ts', 'import { streamText } from "ai"')).findings,
  ).toHaveLength(1);
});
test('blocks HTML sinks while allowing safe text edits', async () => {
  expect((await check('src/content/editor.ts', 'node.innerHTML = result;')).findings).toHaveLength(
    1,
  );
  expect((await check('src/content/editor.ts', 'node.data = result;')).findings).toHaveLength(0);
});
