import { confirmRequest, toasts } from "../state.ts";
import { Dialog } from "./Dialog.tsx";

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => <div key={t.id} class={`toast toast-${t.kind}`}>{t.message}</div>)}
    </div>
  );
}

export function ConfirmDialog() {
  const request = confirmRequest.value;
  if (!request) return null;
  const answer = (ok: boolean) => {
    confirmRequest.value = null;
    request.resolve(ok);
  };
  return (
    <Dialog title={request.title} onClose={() => answer(false)}>
      <p class="dialog-body">{request.body}</p>
      <footer class="dialog-actions">
        <button type="button" onClick={() => answer(false)}>Cancel</button>
        <button
          type="button"
          class={request.danger ? "danger" : "primary"}
          autofocus
          onClick={() => answer(true)}
        >
          {request.confirmLabel}
        </button>
      </footer>
    </Dialog>
  );
}
