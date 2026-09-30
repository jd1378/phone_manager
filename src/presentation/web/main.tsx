import { render } from "preact";
import { ApiError } from "./api.ts";
import { Shell } from "./components/Shell.tsx";
import { bootstrap, describeError } from "./state.ts";

/** Present only inside the `deno desktop` webview; see src/desktop.ts. */
const desktop = (globalThis as { bindings?: { sessionToken(): Promise<string> } }).bindings;

const root = document.getElementById("root")!;

async function start() {
  try {
    await bootstrap();
    render(<Shell />, root);
  } catch (error) {
    if (error instanceof ApiError && error.code === "unauthorized" && desktop) {
      location.replace(`/login?token=${encodeURIComponent(await desktop.sessionToken())}`);
      return;
    }
    root.textContent = "";
    const message = document.createElement("p");
    message.className = "fatal";
    message.textContent = `Phone Manager could not start: ${describeError(error)}. ` +
      "Open the address printed in the terminal where Phone Manager is running.";
    root.append(message);
  }
}

start();
