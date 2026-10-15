import css from './overlay.css?raw';

type Action = { label: string; run: () => void };

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export class Overlay {
  private host = document.createElement('noble-gas-ui');
  private root = this.host.attachShadow({ mode: 'closed' });
  private bar = element('div', 'bar');
  private message = element('div', 'message');
  private actions = element('div', 'actions');
  private outline = element('div', 'outline');
  private paper: HTMLDivElement | undefined;

  constructor() {
    this.host.dataset.nobleGas = '';
    this.host.style.cssText =
      'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const style = document.createElement('style');
    style.textContent = css;
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');
    this.bar.setAttribute('aria-label', 'Noble Gas');
    this.bar.append(element('span', 'badge', 'NG'), this.message, this.actions);
    this.root.append(style, this.outline, this.bar);
    this.outline.hidden = true;
    this.bar.hidden = true;
  }

  show(text: string, actions: Action[] = [], busy = false): void {
    if (!this.host.isConnected) document.documentElement.append(this.host);
    this.bar.hidden = false;
    this.bar.classList.toggle('busy', busy);
    this.message.textContent = text;
    this.actions.replaceChildren();
    for (const action of actions) {
      const button = element('button', '', action.label);
      button.type = 'button';
      button.addEventListener('click', action.run);
      this.actions.append(button);
    }
  }

  highlight(rect?: DOMRect): void {
    this.outline.hidden = !rect;
    if (!rect) return;
    Object.assign(this.outline.style, {
      left: `${rect.left - 6}px`,
      top: `${rect.top - 5}px`,
      width: `${rect.width + 12}px`,
      height: `${rect.height + 10}px`,
    });
  }

  async reveal(text: string, rect: DOMRect, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const paper = element('div', 'paper');
    this.paper = paper;
    const width = Math.max(240, Math.min(rect.width + 40, 640, window.innerWidth - 32));
    Object.assign(paper.style, {
      width: `${width}px`,
      left: `${Math.max(16, Math.min(rect.left - 20, window.innerWidth - width - 16))}px`,
      top: `${Math.max(16, Math.min(rect.top - 16, window.innerHeight - 400))}px`,
    });
    const label = element('div', 'paper-label');
    label.append(element('span', '', 'NG / RECOMPOSITION'), element('span', '', '04.00'));
    const body = element('div', 'paper-text');
    paper.append(label, body);
    this.root.append(paper);
    await paper.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'translateY(-8px)' },
      ],
      {
        duration: 180,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'forwards',
      },
    ).finished;
    const preview = text.length > 900 ? `${text.slice(0, 900)}…` : text;
    const graphemes = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(preview),
    ].map((part) => part.segment);
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (signal.aborted) {
          reject(new DOMException('Stopped', 'AbortError'));
          return;
        }
        const progress = Math.min(1, (performance.now() - started) / 720);
        body.textContent = graphemes.slice(0, Math.ceil(progress * graphemes.length)).join('');
        if (progress === 1) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    signal.throwIfAborted();
  }

  async settle(): Promise<void> {
    if (this.paper) {
      await this.paper.animate(
        [
          { opacity: 1, transform: 'translateY(-8px)' },
          { opacity: 0, transform: 'translateY(0)' },
        ],
        {
          duration: 240,
          easing: 'ease-in',
          fill: 'forwards',
        },
      ).finished;
    }
    this.clearPaper();
  }

  clearPaper(): void {
    this.paper?.remove();
    this.paper = undefined;
    this.highlight();
  }
  hide(): void {
    this.clearPaper();
    this.host.remove();
  }
}
