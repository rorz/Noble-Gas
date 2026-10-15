export function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
}

export function showStatus(text: string, error = false): void {
  const status = query<HTMLElement>('#status');
  status.textContent = text;
  status.dataset.error = String(error);
}
