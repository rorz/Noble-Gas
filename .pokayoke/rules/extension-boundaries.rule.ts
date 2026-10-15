import { type Finding, forEachTypescriptNode, type Rule } from 'pokayoke';

export const extensionBoundaries: Rule = {
  meta: {
    id: 'repo/extension-boundaries',
    docs: 'Keep model calls in the background worker and prevent HTML injection in page editing code.',
    kind: 'file',
  },
  async run(context) {
    const findings: Finding[] = [];
    for (const file of await context.files()) {
      if (!file.endsWith('.ts')) continue;
      const source = await context.parseTypescript(file);
      forEachTypescriptNode(source, (node) => {
        if (
          'moduleSpecifier' in node &&
          node.moduleSpecifier &&
          typeof node.moduleSpecifier === 'object' &&
          'text' in node.moduleSpecifier &&
          typeof node.moduleSpecifier.text === 'string'
        ) {
          const name = node.moduleSpecifier.text;
          if (
            (name === 'ai' || name.startsWith('@ai-sdk/')) &&
            !file.startsWith('src/background/')
          ) {
            findings.push({
              ruleId: 'repo/extension-boundaries',
              severity: 'error' as const,
              file,
              message:
                'Model SDK imports belong in src/background/. Keep credentials away from webpages.',
            });
          }
        }
        if (
          file.startsWith('src/content/') &&
          'expression' in node &&
          'name' in node &&
          node.name &&
          typeof node.name === 'object' &&
          'text' in node.name &&
          typeof node.name.text === 'string' &&
          ['innerHTML', 'outerHTML', 'insertAdjacentHTML'].includes(node.name.text)
        ) {
          findings.push({
            ruleId: 'repo/extension-boundaries',
            severity: 'error' as const,
            file,
            message: 'Page editing must use text nodes, never HTML sinks.',
          });
        }
      });
    }
    return { findings };
  },
};
