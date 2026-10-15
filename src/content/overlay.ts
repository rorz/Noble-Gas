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
  private skeleton = element('div', 'skeleton');
  private tracking: AbortController | undefined;
  private frame: number | undefined;
  private redraw: (() => void) | undefined;
  private markers = new Map<HTMLElement, () => void>();

  constructor() {
    this.host.dataset.nobleGas = '';
    this.host.style.cssText =
      'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const style = document.createElement('style');
    style.textContent = css;
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');
    this.bar.setAttribute('aria-label', 'Noble Gas');
    this.bar.append(this.message, this.actions);
    this.skeleton.setAttribute('aria-hidden', 'true');
    this.root.append(style, this.outline, this.skeleton, this.bar);
    this.outline.hidden = true;
    this.bar.hidden = true;
  }

  show(text: string, actions: Action[] = []): void {
    this.mount();
    this.bar.hidden = false;
    this.message.textContent = text;
    this.actions.replaceChildren();
    for (const action of actions) {
      const button = element('button', '', action.label);
      button.type = 'button';
      button.addEventListener('click', action.run);
      this.actions.append(button);
    }
  }

  markRewrite(
    ranges: () => Range[],
    removed: number,
    undo: () => void,
    toggle: () => 'original' | 'rewritten' | undefined,
  ): () => void {
    this.mount();
    const marker = element('div', 'rewrite-marker');
    const outline = element('div', 'outline completed');
    const chip = element('div', 'rewrite-chip');
    const compare = element('button', '', 'Show Original');
    compare.type = 'button';
    compare.addEventListener('click', () => {
      const view = toggle();
      if (!view) return;
      compare.textContent = view === 'original' ? 'Show Rewritten' : 'Show Original';
      this.updateLoading();
    });
    const button = element('button', '', 'Undo');
    button.type = 'button';
    button.setAttribute('aria-label', 'Undo this rewrite');
    button.addEventListener('click', undo);
    chip.append(
      element('span', 'removed', `${removed} ${removed === 1 ? 'word' : 'words'} removed`),
      compare,
      button,
    );
    marker.append(outline, chip);
    this.root.insertBefore(marker, this.bar);
    this.markers.set(marker, () => {
      const rects = ranges()
        .map((range) => range.getBoundingClientRect())
        .filter((rect) => rect.width && rect.height);
      marker.hidden = rects.length === 0;
      if (!rects.length) return;
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      marker.hidden = bottom <= 0 || top >= innerHeight || right <= 0 || left >= innerWidth;
      if (marker.hidden) return;
      this.positionOutline(outline, new DOMRect(left, top, right - left, bottom - top));
      Object.assign(chip.style, {
        left: `${Math.max(chip.offsetWidth + 8, Math.min(right + 6, innerWidth - 8))}px`,
        top: `${Math.max(8, top - chip.offsetHeight - 5)}px`,
      });
    });
    this.updateLoading();
    return () => {
      this.markers.delete(marker);
      marker.remove();
      this.updateLoading();
      this.unmountIfIdle();
    };
  }

  highlight(rect?: DOMRect): void {
    this.outline.hidden = !rect;
    if (!rect) return;
    this.positionOutline(this.outline, rect);
  }

  private positionOutline(outline: HTMLElement, rect: DOMRect): void {
    Object.assign(outline.style, {
      left: `${rect.left - 6}px`,
      top: `${rect.top - 5}px`,
      width: `${rect.width + 12}px`,
      height: `${rect.height + 10}px`,
    });
  }

  startLoading(selection: () => Range | undefined, pending: () => Range[]): void {
    this.clearLoading();
    this.redraw = () => {
      const range = selection();
      this.highlight(range?.getBoundingClientRect());
      const lines = document.createDocumentFragment();
      for (const range of pending()) {
        const parent = range.startContainer.parentElement;
        const ink = parent ? getComputedStyle(parent).color : '#333';
        let background = '#fff';
        for (let node = parent; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
            background = color;
            break;
          }
        }
        for (const rect of range.getClientRects()) {
          if (rect.bottom < 0 || rect.top > window.innerHeight || !rect.width || !rect.height)
            continue;
          const line = element('div', 'skeleton-line');
          Object.assign(line.style, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          });
          line.style.setProperty('--page-ink', ink);
          line.style.setProperty('--page-background', background);
          lines.append(line);
        }
      }
      this.skeleton.replaceChildren(lines);
    };
    this.updateLoading();
  }

  private mount(): void {
    if (this.host.isConnected) return;
    document.documentElement.append(this.host);
    this.tracking = new AbortController();
    const { signal } = this.tracking;
    document.addEventListener('scroll', () => this.updateLoading(), {
      signal,
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', () => this.updateLoading(), { signal });
    const resize = new ResizeObserver(() => this.updateLoading());
    resize.observe(document.documentElement);
    const mutation = new MutationObserver(() => this.updateLoading());
    if (document.body) {
      resize.observe(document.body);
      mutation.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['hidden', 'class', 'style'],
      });
    }
    signal.addEventListener(
      'abort',
      () => {
        resize.disconnect();
        mutation.disconnect();
      },
      { once: true },
    );
  }

  updateLoading(): void {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.redraw?.();
      for (const redraw of this.markers.values()) redraw();
    });
  }

  clearLoading(): void {
    this.redraw = undefined;
    this.skeleton.replaceChildren();
    this.highlight();
    this.updateLoading();
  }
  hide(): void {
    this.clearLoading();
    this.bar.hidden = true;
    this.unmountIfIdle();
  }

  private unmountIfIdle(): void {
    if (!this.bar.hidden || this.markers.size) return;
    this.tracking?.abort();
    this.tracking = undefined;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.host.remove();
  }
}
