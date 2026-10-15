import { type Activation, errorMessage } from '../shared/contracts';
import { validateRewrite } from '../shared/validation';
import { Overlay } from './overlay';
import { type Passage, passageForElement, pickableBlock, selectedPassage } from './selection';
import { applyRewrite, passageText, type Transaction, undoRewrite } from './transaction';
import type { RewriteTransport } from './transport';

export class PageController {
  private ui = new Overlay();
  private abort: AbortController | undefined;
  private picker: AbortController | undefined;
  private history: Transaction[] = [];

  constructor(private transport: RewriteTransport) {}

  activate(mode: Activation): void {
    if (this.abort) return;
    this.stopPicker();
    if (mode === 'undo') {
      this.undoLast();
      return;
    }
    const hasSelection = Boolean(window.getSelection()?.toString().trim());
    if (mode === 'selection' || (mode === 'auto' && hasSelection)) {
      try {
        void this.rewrite(selectedPassage());
      } catch (error) {
        this.showError(error);
      }
    } else {
      window.getSelection()?.removeAllRanges();
      this.startPicker();
    }
  }

  private stopPicker(): void {
    this.picker?.abort();
    this.picker = undefined;
    this.ui.highlight();
  }

  private startPicker(): void {
    this.picker = new AbortController();
    const { signal } = this.picker;
    let target: Element | null = null;
    const cancel = () => {
      this.stopPicker();
      this.ui.hide();
    };
    this.ui.show('Click a passage. Or highlight text, then press Enter.', [
      { label: 'Cancel · Esc', run: cancel },
    ]);
    document.addEventListener(
      'pointermove',
      (event) => {
        target = pickableBlock(event.target);
        this.ui.highlight(target?.getBoundingClientRect());
      },
      { signal, capture: true },
    );
    document.addEventListener('scroll', () => this.ui.highlight(target?.getBoundingClientRect()), {
      signal,
      capture: true,
      passive: true,
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          try {
            const passage = selectedPassage();
            this.stopPicker();
            void this.rewrite(passage);
          } catch (error) {
            this.stopPicker();
            this.showError(error);
          }
        }
      },
      { signal, capture: true },
    );
    document.addEventListener(
      'click',
      (event) => {
        if (window.getSelection()?.toString().trim()) return;
        const block = pickableBlock(event.target);
        if (!block) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          const passage = passageForElement(block);
          this.stopPicker();
          void this.rewrite(passage);
        } catch (error) {
          this.stopPicker();
          this.showError(error);
        }
      },
      { signal, capture: true },
    );
  }

  private showError(error: unknown): void {
    this.ui.clearPaper();
    this.ui.show(errorMessage(error), [{ label: 'Dismiss', run: () => this.ui.hide() }]);
  }

  private showUndo(message: string): void {
    const actions = this.history.length
      ? [
          {
            label: 'Undo',
            run: () => this.undoLast(),
          },
        ]
      : [];
    this.ui.show(message, [...actions, { label: 'Close', run: () => this.ui.hide() }]);
  }

  private undoLast(): void {
    const last = this.history.at(-1);
    if (!last) {
      this.showUndo('Nothing to undo on this page.');
      return;
    }
    try {
      undoRewrite(last);
      this.history.pop();
      this.showUndo('Original text restored.');
    } catch (error) {
      this.showError(error);
    }
  }

  private async rewrite(passage: Passage): Promise<void> {
    if (this.abort) return;
    const abort = new AbortController();
    this.abort = abort;
    const cancel = () => abort.abort();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', onEscape, { signal: abort.signal });
    this.ui.highlight(passage.range.getBoundingClientRect());
    this.ui.show(
      'Distilling. Keeping the substance.',
      [{ label: 'Cancel · Esc', run: cancel }],
      true,
    );
    try {
      const result = await this.transport(passage.segments, abort.signal);
      abort.signal.throwIfAborted();
      const output = validateRewrite(passage.segments, result.output);
      const byId = new Map(output.segments.map((segment) => [segment.id, segment.text]));
      if (passage.segments.every((segment) => byId.get(segment.id) === segment.text)) {
        this.ui.clearPaper();
        this.showUndo('Already clear. No changes needed.');
        return;
      }
      const motion = result.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (motion) {
        const text = passageText(
          passage.segments.map((segment) => ({
            ...segment,
            text: byId.get(segment.id) ?? segment.text,
          })),
        );
        await this.ui.reveal(text, passage.range.getBoundingClientRect(), abort.signal);
      }
      abort.signal.throwIfAborted();
      const transaction = applyRewrite(passage, output);
      this.history.push(transaction);
      if (this.history.length > 10) this.history.shift();
      await this.ui.settle();
      const fewer = transaction.beforeWords - transaction.afterWords;
      this.showUndo(
        fewer > 0 ? `Recomposed. ${fewer} fewer words.` : 'Recomposed. Same substance.',
      );
    } catch (error) {
      if (abort.signal.aborted) {
        this.ui.clearPaper();
        this.showUndo('Stopped. Your original text is still here.');
      } else this.showError(error);
    } finally {
      document.removeEventListener('keydown', onEscape);
      this.abort = undefined;
    }
  }
}
