import { useState } from "preact/hooks";
import { api } from "../api.ts";
import { describeError, devices, dialog, toast } from "../state.ts";
import { Dialog } from "./Dialog.tsx";

/** Accepts "192.168.1.20:37123", "[fe80::1]:5555" or a host plus a separate port. */
function parseAddress(address: string, port: string): { host: string; port: number } | null {
  const trimmed = address.trim();
  const bracketed = trimmed.match(/^\[(.+)\]:(\d+)$/);
  if (bracketed) return { host: bracketed[1], port: Number(bracketed[2]) };
  const hostPort = trimmed.match(/^([^:\s]+):(\d+)$/);
  if (hostPort) return { host: hostPort[1], port: Number(hostPort[2]) };
  return trimmed && port ? { host: trimmed.replace(/^\[|\]$/g, ""), port: Number(port) } : null;
}

export function PairDialog() {
  const [pairAddress, setPairAddress] = useState("");
  const [code, setCode] = useState("");
  const [connectAddress, setConnectAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => (dialog.value = null);
  const wireless = devices.value.filter((d) => d.wireless);

  const run = async (work: () => Promise<{ message: string }>) => {
    setBusy(true);
    try {
      toast((await work()).message);
      return true;
    } catch (error) {
      toast(describeError(error), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Connect over Wi-Fi" onClose={close} wide>
      <div class="dialog-body pair">
        <p>
          On the phone open Developer options, then Wireless debugging. The phone and this computer must be on
          the same network.
        </p>
        <form
          class="pair-step"
          onSubmit={async (e) => {
            e.preventDefault();
            const target = parseAddress(pairAddress, "");
            if (!target) {
              return toast("Enter the address shown on the phone, like 192.168.1.20:37123", "error");
            }
            if (await run(() => api.pair(target.host, target.port, code.trim()))) {
              setCode("");
              setConnectAddress(target.host + ":");
            }
          }}
        >
          <h3>First time: pair</h3>
          <p class="muted">Tap "Pair device with pairing code" and enter what it shows.</p>
          <label class="field">
            <span>IP address and port</span>
            <input
              placeholder="192.168.1.20:37123"
              value={pairAddress}
              onInput={(e) => setPairAddress(e.currentTarget.value)}
              required
            />
          </label>
          <label class="field">
            <span>Wi-Fi pairing code</span>
            <input
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="123456"
              value={code}
              onInput={(e) => setCode(e.currentTarget.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>Pair</button>
        </form>
        <form
          class="pair-step"
          onSubmit={async (e) => {
            e.preventDefault();
            const target = parseAddress(connectAddress, "");
            if (!target) {
              return toast(
                "Enter the address from the Wireless debugging screen, like 192.168.1.20:41235",
                "error",
              );
            }
            if (await run(() => api.connect(target.host, target.port))) close();
          }}
        >
          <h3>Connect</h3>
          <p class="muted">
            Use the "IP address and port" shown at the top of the Wireless debugging screen. It differs from
            the pairing port.
          </p>
          <label class="field">
            <span>IP address and port</span>
            <input
              placeholder="192.168.1.20:41235"
              value={connectAddress}
              onInput={(e) => setConnectAddress(e.currentTarget.value)}
              required
            />
          </label>
          <button type="submit" class="primary" disabled={busy}>Connect</button>
        </form>
        {wireless.length > 0 && (
          <div class="pair-step">
            <h3>Connected over Wi-Fi</h3>
            <ul class="plain-list">
              {wireless.map((d) => (
                <li key={d.serial} class="field-row">
                  <span>
                    {d.model ?? d.serial} <span class="mono muted">{d.serial}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      run(() => api.disconnect(d.serial).then(() => ({ message: "Disconnected" })))}
                  >
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
