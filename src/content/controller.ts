import { type Activation, errorMessage } from '../shared/contracts';
import { validateRewrite } from '../shared/validation';
import { Overlay } from './overlay';
import { type Passage, passageForElement, pickableBlock, selectedPassage } from './selection';
import {
  RewriteSession,
  rewrittenRanges,
  type Transaction,
  toggleRewrite,
  undoRewrite,
} from './transaction';
import type { RewriteTransport } from './transport';

export class PageController {
  private ui = new Overlay();
  private abort: AbortController | undefined;
  private picker: AbortController | undefined;
  private contextTarget: Element | null = null;
  private history: { transaction: Transaction; removeMarker: () => void }[] = [];

  constructor(private transport: RewriteTransport) {
    document.addEventListener(
      'contextmenu',
      (event) => {
        this.contextTarget = pickableBlock(event.target);
      },
      { capture: true },
    );
  }

  activate(mode: Activation): void {
    if (this.abort) return;
    this.stopPicker();
    if (mode === 'undo') {
      this.undoLast();
      return;
    }
    const hasSelection = Boolean(window.getSelection()?.toString().trim());
    if (mode === 'selection' || ((mode === 'auto' || mode === 'context') && hasSelection)) {
      try {
        void this.rewrite(selectedPassage());
      } catch (error) {
        this.showError(error);
      }
    } else if (mode === 'context' && this.contextTarget?.isConnected) {
      try {
        void this.rewrite(passageForElement(this.contextTarget));
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
    this.ui.clearLoading();
    this.ui.show(errorMessage(error), [{ label: 'Dismiss', run: () => this.ui.hide() }]);
  }

  private undoLast(): void {
    const last = this.history.at(-1);
    if (!last) {
      this.ui.hide();
      return;
    }
    this.undo(last.transaction);
  }

  private undo(transaction: Transaction): void {
    if (this.abort) return;
    this.stopPicker();
    try {
      undoRewrite(transaction);
      const index = this.history.findIndex((entry) => entry.transaction === transaction);
      this.history.splice(index, 1)[0]?.removeMarker();
      this.ui.hide();
    } catch (error) {
      this.showError(error);
    }
  }

  private toggle(transaction: Transaction): Transaction['view'] | undefined {
    if (this.abort) return;
    this.stopPicker();
    try {
      toggleRewrite(transaction);
      this.ui.hide();
      return transaction.view;
    } catch (error) {
      this.showError(error);
    }
  }

  private async rewrite(passage: Passage): Promise<void> {
    if (this.abort) return;
    const abort = new AbortController();
    const session = new RewriteSession(passage);
    this.abort = abort;
    const cancel = () => abort.abort();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', onEscape, { signal: abort.signal });
    window.getSelection()?.removeAllRanges();
    this.ui.show('Rewriting…', [{ label: 'Cancel · Esc', run: cancel }]);
    this.ui.startLoading(
      () => session.selectionRange(),
      () => session.pendingRanges(),
    );
    try {
      const result = await this.transport(passage.segments, abort.signal, (output) => {
        abort.signal.throwIfAborted();
        session.preview(output);
        this.ui.updateLoading();
      });
      abort.signal.throwIfAborted();
      const output = validateRewrite(passage.segments, result.output);
      const byId = new Map(output.segments.map((segment) => [segment.id, segment.text]));
      if (passage.segments.every((segment) => byId.get(segment.id) === segment.text)) {
        session.rollback();
        this.ui.hide();
        return;
      }
      const transaction = session.commit(output);
      this.ui.clearLoading();
      const removeMarker = this.ui.markRewrite(
        () => rewrittenRanges(transaction),
        Math.max(0, transaction.beforeWords - transaction.afterWords),
        () => this.undo(transaction),
        () => this.toggle(transaction),
      );
      this.history.push({ transaction, removeMarker });
      if (this.history.length > 10) this.history.shift()?.removeMarker();
      this.ui.hide();
    } catch (error) {
      session.rollback();
      this.ui.clearLoading();
      if (abort.signal.aborted) {
        this.ui.hide();
      } else this.showError(error);
    } finally {
      document.removeEventListener('keydown', onEscape);
      this.abort = undefined;
    }
  }
}
