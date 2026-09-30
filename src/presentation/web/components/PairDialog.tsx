import { useEffect, useState } from "preact/hooks";
import type { Device, DiscoveredService } from "../../../domain/models.ts";
import { api } from "../api.ts";
import { describeError, devices, dialog, toast } from "../state.ts";
import { Dialog } from "./Dialog.tsx";

const DISCOVERY_INTERVAL_MS = 2000;

/** Accepts "192.168.1.20:37123" or "[fe80::1]:5555". */
function parseAddress(address: string): { host: string; port: number } | null {
  const trimmed = address.trim();
  const match = trimmed.match(/^\[(.+)\]:(\d+)$/) ?? trimmed.match(/^([^:\s]+):(\d+)$/);
  return match ? { host: match[1], port: Number(match[2]) } : null;
}

const address = (service: { host: string; port: number }) =>
  service.host.includes(":") ? `[${service.host}]:${service.port}` : `${service.host}:${service.port}`;

const isConnected = (service: DiscoveredService, list: Device[]) =>
  list.some((d) => d.serial === `${service.name}._adb-tls-connect._tcp` || d.serial === address(service));

export function PairDialog() {
  const [found, setFound] = useState<DiscoveredService[]>([]);
  const [pairAddress, setPairAddress] = useState("");
  const [code, setCode] = useState("");
  const [connectAddress, setConnectAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => (dialog.value = null);
  const wireless = devices.value.filter((d) => d.wireless);
  const pairing = found.filter((s) => s.kind === "pairing");
  const connectable = found.filter((s) => s.kind === "connect" && !isConnected(s, devices.value));

  useEffect(() => {
    let active = true;
    const poll = () => api.discover().then((services) => active && setFound(services), () => {});
    poll();
    const timer = setInterval(poll, DISCOVERY_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // Fill in the pairing address as soon as the phone's pairing popup is announced.
  useEffect(() => {
    if (pairing.length === 1 && !pairAddress) setPairAddress(address(pairing[0]));
  }, [pairing.map(address).join()]);

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

  const connect = async (target: { host: string; port: number }) => {
    if (await run(() => api.connect(target.host, target.port))) close();
  };

  return (
    <Dialog title="Connect over Wi-Fi" onClose={close} wide>
      <div class="dialog-body pair">
        <p>
          On the phone open Developer options, then Wireless debugging. The phone and this computer must be on
          the same network.
        </p>

        {connectable.length > 0 && (
          <div class="pair-step">
            <h3>Found on this network</h3>
            <p class="muted">Connect works once this computer has been paired with the phone.</p>
            <ul class="plain-list">
              {connectable.map((s) => (
                <li key={s.name} class="field-row">
                  <span class="mono">{address(s)}</span>
                  <button type="button" class="primary" disabled={busy} onClick={() => connect(s)}>
                    Connect
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form
          class="pair-step"
          onSubmit={async (e) => {
            e.preventDefault();
            const target = parseAddress(pairAddress);
            if (!target) {
              return toast(
                "Enter the IP address and port from the pairing popup, like 192.168.1.20:37123",
                "error",
              );
            }
            if (found.some((s) => s.kind === "connect" && s.host === target.host && s.port === target.port)) {
              return toast(
                "That is the connection port from the Wireless debugging screen. Tap 'Pair device with pairing code' " +
                  "and use the IP address and port shown in that popup.",
                "error",
              );
            }
            if (!(await run(() => api.pair(target.host, target.port, code.trim())))) return;
            setCode("");
            setPairAddress("");
            // adb usually connects by itself after pairing; connecting explicitly covers the rest.
            const service = found.find((s) => s.kind === "connect" && s.host === target.host);
            if (service) await connect(service);
            else setConnectAddress(`${target.host}:`);
          }}
        >
          <h3>Pair (first time only)</h3>
          <p class="muted">
            Tap "Pair device with pairing code" and keep that popup open. Its port is different from the one
            on the Wireless debugging screen.
          </p>
          {pairing.length > 0
            ? (
              <p>
                Pairing popup found at <span class="mono">{pairing.map(address).join(", ")}</span>.
              </p>
            )
            : <p class="muted">Waiting for the pairing popup… You can also type its address.</p>}
          <label class="field">
            <span>IP address and port from the popup</span>
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
              autocomplete="off"
              value={code}
              onInput={(e) => setCode(e.currentTarget.value)}
              required
            />
          </label>
          <button type="submit" class="primary" disabled={busy}>Pair</button>
        </form>

        <form
          class="pair-step"
          onSubmit={(e) => {
            e.preventDefault();
            const target = parseAddress(connectAddress);
            if (!target) {
              return toast(
                "Enter the address from the Wireless debugging screen, like 192.168.1.20:41235",
                "error",
              );
            }
            connect(target);
          }}
        >
          <h3>Connect by address</h3>
          <p class="muted">
            If the phone is not found above, use the "IP address and port" at the top of the Wireless
            debugging screen.
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
          <button type="submit" disabled={busy}>Connect</button>
        </form>

        {wireless.length > 0 && (
          <div class="pair-step">
            <h3>Connected over Wi-Fi</h3>
            <ul class="plain-list">
              {wireless.map((d) => (
                <li key={d.serial} class="field-row">
                  <span>
                    {d.model && `${d.model} `}
                    <span class="mono muted">{d.serial}</span>
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
