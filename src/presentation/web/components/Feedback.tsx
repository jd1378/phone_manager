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
      <p class="dialog-body confirm-body">{request.body}</p>
      <footer class="dialog-actions">
        {/* Enter must not confirm a destructive action by accident. */}
        <button type="button" autofocus={request.danger} onClick={() => answer(false)}>Cancel</button>
        <button
          type="button"
          class={request.danger ? "danger" : "primary"}
          autofocus={!request.danger}
          onClick={() => answer(true)}
        >
          {request.confirmLabel}
        </button>
      </footer>
    </Dialog>
  );
}
