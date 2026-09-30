import type { Device, DeviceState } from "../../../domain/models.ts";
import { formatBytes } from "../format.ts";
import { TasksMenu } from "./TasksMenu.tsx";
import {
  apps,
  currentDevice,
  deviceInfo,
  deviceReady,
  devices,
  dialog,
  installFiles,
  library,
  serial,
  tab,
  user,
} from "../state.ts";

const STATE_LABEL: Record<DeviceState, string> = {
  device: "",
  unauthorized: "waiting for approval",
  offline: "offline",
  "no-permissions": "no USB permission",
  authorizing: "authorizing",
  connecting: "connecting",
  recovery: "recovery mode",
  sideload: "sideload mode",
  bootloader: "bootloader",
  unknown: "unknown state",
};

export const STATE_HELP: Partial<Record<DeviceState, string>> = {
  unauthorized: "Unlock the phone and tap Allow on the 'Allow USB debugging?' prompt.",
  offline: "The phone stopped responding. Reconnect the cable, or toggle USB debugging off and on.",
  "no-permissions":
    "Your computer is not allowed to talk to this phone over USB. On Linux, add a udev rule for the phone (or install android-udev-rules) and reconnect.",
  authorizing: "Waiting for the phone to finish the USB debugging handshake.",
  connecting: "Connecting…",
};

const deviceLabel = (device: Device) => {
  const name = device.model ?? device.serial;
  const how = device.wireless ? "Wi-Fi" : "USB";
  const state = STATE_LABEL[device.state];
  return state ? `${name} (${how}, ${state})` : `${name} (${how})`;
};

export function TopBar() {
  const info = deviceInfo.value;
  const device = currentDevice.value;
  const storageUsed = info?.storage ? 1 - info.storage.freeBytes / info.storage.totalBytes : null;
  return (
    <header class="topbar">
      <div class="topbar-row">
        <div class="topbar-device">
          <label class="visually-hidden" for="device-select">Phone</label>
          <select
            id="device-select"
            class="device-select"
            value={serial.value ?? ""}
            onChange={(event) => (serial.value = event.currentTarget.value || null)}
            disabled={devices.value.length === 0}
          >
            {devices.value.length === 0 && <option value="">No phone connected</option>}
            {devices.value.map((d) => <option key={d.serial} value={d.serial}>{deviceLabel(d)}</option>)}
          </select>
          {info && deviceReady.value && (
            <ul class="device-facts" aria-label="Phone details">
              <li>Android {info.androidVersion} (API {info.sdk})</li>
              {info.batteryLevel !== null && <li>{info.batteryLevel}% battery</li>}
              {info.storage && storageUsed !== null && (
                <li class="storage">
                  <meter
                    min={0}
                    max={1}
                    low={0.8}
                    high={0.9}
                    optimum={0}
                    value={storageUsed}
                    aria-label="Storage used"
                  />
                  {formatBytes(info.storage.freeBytes)} free
                </li>
              )}
            </ul>
          )}
          {info && info.users.length > 1 && (
            <select
              class="user-select"
              aria-label="Android user or profile"
              value={String(user.value)}
              onChange={(event) => (user.value = Number(event.currentTarget.value))}
            >
              {info.users.map((u) => <option key={u.id} value={u.id}>{u.name || `User ${u.id}`}</option>)}
            </select>
          )}
          {device?.wireless && device.state !== "device" && <span class="muted">Wi-Fi connection lost</span>}
        </div>
        <div class="topbar-actions">
          <label class={`button primary${deviceReady.value ? "" : " disabled"}`}>
            Install APK…
            <input
              type="file"
              class="visually-hidden"
              accept=".apk,.apks,.xapk,.apkm"
              multiple
              disabled={!deviceReady.value}
              onChange={(event) => {
                const input = event.currentTarget;
                installFiles([...(input.files ?? [])]);
                input.value = "";
              }}
            />
          </label>
          <button type="button" onClick={() => (dialog.value = "pair")}>Connect over Wi-Fi</button>
          <button type="button" onClick={() => (dialog.value = "settings")}>Settings</button>
          <TasksMenu />
        </div>
      </div>
      <nav class="tabs" aria-label="Sections">
        <button
          type="button"
          class="tab"
          aria-current={tab.value === "apps" ? "page" : undefined}
          onClick={() => (tab.value = "apps")}
        >
          Apps <span class="count">{apps.value.length || ""}</span>
        </button>
        <button
          type="button"
          class="tab"
          aria-current={tab.value === "library" ? "page" : undefined}
          onClick={() => (tab.value = "library")}
        >
          Backups <span class="count">{library.value.length || ""}</span>
        </button>
      </nav>
    </header>
  );
}
