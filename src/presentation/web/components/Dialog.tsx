import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** Native modal <dialog>: focus trapping, Escape and backdrop come from the browser. */
export function Dialog(
  { title, onClose, children, wide = false }: {
    title: string;
    onClose: () => void;
    children: ComponentChildren;
    wide?: boolean;
  },
) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => dialog.open && dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      class={wide ? "dialog dialog-wide" : "dialog"}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header class="dialog-head">
        <h2>{title}</h2>
        <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>✕</button>
      </header>
      {children}
    </dialog>
  );
}
