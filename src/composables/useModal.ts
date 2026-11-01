import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue';

interface UseModalOptions {
  /** Called on Escape. */
  onClose: () => void;
  /** Element to focus on open; defaults to the first tabbable control, then the dialog itself. */
  initialFocus?: Ref<HTMLElement | null>;
  /** Return false to ignore Escape (e.g. while work is in progress). */
  canClose?: () => boolean;
  /**
   * Open state for a dialog that stays mounted. Omit it when the dialog component
   * is mounted only while open (v-if), and it activates on mount.
   */
  open?: Ref<boolean>;
}

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Open dialogs, innermost last: only the top one handles keys.
const stack: symbol[] = [];
// How each open dialog asks to close (Escape's rule), for the Android back button.
const closers = new Map<symbol, () => void>();

/** Android back button: asks the innermost dialog to close. False when no dialog is open. */
export function closeTopModal(): boolean {
  const id = stack[stack.length - 1];
  if (!id) return false;
  closers.get(id)?.();
  return true;
}

/**
 * For a popup that isn't a modal, such as a disclosure dropdown: while `open`, the Android
 * back button closes it like a dialog. Its keys and focus stay the popup's own business.
 */
export function useDismissable(open: Ref<boolean>, close: () => void) {
  const id = Symbol('dismissable');

  function remove() {
    const i = stack.indexOf(id);
    if (i >= 0) stack.splice(i, 1);
    closers.delete(id);
  }

  watch(
    open,
    (isOpen) => {
      if (!isOpen) {
        remove();
      } else if (!closers.has(id)) {
        stack.push(id);
        closers.set(id, close);
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(remove);
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  );
}

/**
 * Modal focus management: moves focus into the dialog on open, keeps Tab
 * inside it, closes on Escape and returns focus to where it was on close.
 * The dialog element should have tabindex="-1" so it can hold focus itself
 * when it has no enabled controls.
 */
export function useModal(dialogRef: Ref<HTMLElement | null>, options: UseModalOptions) {
  const id = Symbol('modal');
  let active = false;
  let returnFocus: HTMLElement | null = null;

  function requestClose(): boolean {
    if (options.canClose && !options.canClose()) return false;
    options.onClose();
    return true;
  }

  function focusInitial() {
    const dialog = dialogRef.value;
    if (!dialog) return;
    const target = options.initialFocus?.value ?? tabbables(dialog)[0] ?? dialog;
    target.focus();
  }

  // Listening on window (not the dialog) so Escape and Tab still work after
  // focus drops to <body>, e.g. when the focused button becomes disabled.
  function onKeydown(e: KeyboardEvent) {
    if (stack[stack.length - 1] !== id) return;
    const dialog = dialogRef.value;
    if (!dialog) return;

    if (e.key === 'Escape') {
      if (!requestClose()) return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.key !== 'Tab') return;
    const items = tabbables(dialog);
    const current = document.activeElement as HTMLElement | null;
    const inside = !!current && dialog.contains(current);
    if (items.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (!inside || current === first || current === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || current === last)) {
      e.preventDefault();
      first.focus();
    }
  }

  function activate() {
    if (active) return;
    active = true;
    const current = document.activeElement;
    returnFocus = current instanceof HTMLElement && current !== document.body ? current : null;
    stack.push(id);
    closers.set(id, requestClose);
    window.addEventListener('keydown', onKeydown);
    focusInitial();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    window.removeEventListener('keydown', onKeydown);
    const i = stack.indexOf(id);
    if (i >= 0) stack.splice(i, 1);
    closers.delete(id);
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus();
  }

  if (options.open) {
    const open = options.open;
    watch(open, async (isOpen) => {
      if (isOpen) {
        await nextTick();
        if (open.value) activate();
      } else {
        deactivate();
      }
    });
  } else {
    onMounted(activate);
  }

  onBeforeUnmount(deactivate);
}
