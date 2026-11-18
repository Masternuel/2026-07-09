export function bindSearchShortcut(input: HTMLInputElement) {
  const document = input.ownerDocument;
  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey
      || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    if (!input.isConnected || input.disabled || input.hidden
      || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const target = event.target as HTMLElement | null;
    if (target !== input && (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? ''))) return;
    input.focus();
    if (document.activeElement !== input) return;
    input.select();
    event.preventDefault();
  }
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
