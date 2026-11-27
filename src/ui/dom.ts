/** Минимальные помощники для построения DOM без фреймворков (GOAL.md §4.1). */

export type DomChild = Node | string | null | undefined | false;

export interface ElementOptions {
  readonly className?: string;
  readonly text?: string;
  readonly id?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: readonly DomChild[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.id) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
