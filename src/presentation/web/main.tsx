import { render } from "preact";
import { Shell } from "./components/Shell.tsx";
import { bootstrap, describeError } from "./state.ts";

const root = document.getElementById("root")!;
bootstrap()
  .then(() => render(<Shell />, root))
  .catch((error) => {
    root.textContent = "";
    const message = document.createElement("p");
    message.className = "fatal";
    message.textContent = `Phone Manager could not start: ${describeError(error)}. ` +
      "Open the address printed in the terminal where Phone Manager is running.";
    root.append(message);
  });
