import '../../src/ui/base.css';
import './style.css';
import { PageController } from '../../src/content/controller';
import { wordCount } from '../../src/content/transaction';
import { recordings } from '../../src/demo/fixtures';
import { openPopup } from '../../src/ui/bridge';
import { query, showStatus } from '../../src/ui/dom';

const outputs = new Set(recordings.values());
query('#open-popup').addEventListener(
  'click',
  () => void openPopup().catch(() => showStatus('Open Noble Gas from the browser toolbar.', true)),
);
const controller = new PageController(async (segments, signal) => {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, 850);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new DOMException('Stopped', 'AbortError'));
      },
      { once: true },
    );
  });
  let recognized = false;
  const rewritten = segments.map((segment) => {
    if (segment.locked) return { id: segment.id, text: segment.text };
    const replacement = recordings.get(segment.text.trim());
    if (replacement || outputs.has(segment.text.trim())) recognized = true;
    return {
      id: segment.id,
      text: replacement ? segment.text.replace(segment.text.trim(), replacement) : segment.text,
    };
  });
  if (!recognized)
    throw new Error(
      'This demo has recorded rewrites for the sample paragraphs. Try a whole paragraph, or use the extension for live rewrites.',
    );
  return { output: { segments: rewritten }, motion: true };
});

let active = 'article';
const originals = new Map(
  [...document.querySelectorAll<HTMLElement>('.sample')].map((sample) => [
    sample.id,
    wordCount(sample.querySelector('.sample-prose')?.textContent ?? ''),
  ]),
);
function updateCount(): void {
  const current = wordCount(query(`#${active} .sample-prose`).textContent ?? '');
  query('#word-count').textContent = current.toString().padStart(2, '0');
  query('#removed').textContent = Math.max(0, (originals.get(active) ?? 0) - current)
    .toString()
    .padStart(2, '0');
}
for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-sample]')) {
  tab.addEventListener('click', () => {
    active = tab.dataset.sample ?? 'article';
    for (const sample of document.querySelectorAll<HTMLElement>('.sample'))
      sample.hidden = sample.id !== active;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sample]')) {
      const selected = button === tab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    query('#specimen-code').textContent =
      `NG—00${['article', 'readme', 'thread'].indexOf(active) + 1}.TXT`;
    window.getSelection()?.removeAllRanges();
    updateCount();
    showStatus('');
  });
}
query('#run').addEventListener('click', () => {
  const range = document.createRange();
  range.selectNodeContents(query(`#${active} .demo-target`));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  controller.activate('selection');
});
query('#pick').addEventListener('click', () => {
  window.getSelection()?.removeAllRanges();
  controller.activate('pick');
});
query('#reset').addEventListener('click', () => window.location.reload());
new MutationObserver(updateCount).observe(query('#specimens'), {
  characterData: true,
  subtree: true,
});
updateCount();
