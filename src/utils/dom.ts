/* ─── DOM helper utilities ─── */

type Attrs = Record<string, any> & { className?: string; text?: string; html?: string };

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Node | string | undefined | null | false)[]
): HTMLElementTagNameMap[K] {
  const elem = document.createElement(tag);
  if (attrs) {
    if (attrs.className) { elem.className = attrs.className; }
    if (attrs.text) { elem.textContent = attrs.text; }
    if (attrs.html) { elem.innerHTML = attrs.html; }
    // set other attributes/event listeners
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className' || k === 'text' || k === 'html') continue;
      if (k.startsWith('on') && typeof v === 'function') {
        const event = k.slice(2).toLowerCase();
        elem.addEventListener(event, v as EventListener);
      } else if (k === 'style' && typeof v === 'string') {
        elem.setAttribute('style', v);
      } else if (k === 'value') {
        (elem as any).value = v;
      } else if (k === 'checked') {
        (elem as HTMLInputElement).checked = v;
      } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        if (typeof v === 'boolean') {
          if (v) elem.setAttribute(k, '');
          else elem.removeAttribute(k);
        } else {
          elem.setAttribute(k, String(v));
        }
      } else {
        (elem as any)[k] = v;
      }
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    if (typeof child === 'string') {
      elem.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      elem.appendChild(child);
    }
  }
  return elem;
}

export function empty(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  const debounced = (...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  return debounced as unknown as T;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? singular + 's'}`;
}