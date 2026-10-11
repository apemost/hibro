/** Picks the primary readable container, falling back to the body. */
export function readRoot(): HTMLElement {
  return (
    document.querySelector<HTMLElement>('article') ||
    document.querySelector<HTMLElement>('main') ||
    document.querySelector<HTMLElement>('[role="main"]') ||
    document.body
  );
}
