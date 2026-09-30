import { useEffect, useState } from "preact/hooks";
import {
  confirmRequest,
  currentDevice,
  deviceReady,
  devices,
  dialog,
  installDraft,
  installFiles,
  logcatPackage,
  tab,
} from "../state.ts";
import { AppsView } from "./AppsView.tsx";
import { ConfirmDialog, Toasts } from "./Feedback.tsx";
import { InstallDialog } from "./InstallDialog.tsx";
import { LibraryView } from "./LibraryView.tsx";
import { LogcatPanel } from "./LogcatPanel.tsx";
import { PairDialog } from "./PairDialog.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { STATE_HELP, TopBar } from "./TopBar.tsx";

/** Whole-window drop target, shown only while files are dragged over the page. */
function DropZone() {
  const [depth, setDepth] = useState(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDepth((d) => d + 1);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = deviceReady.value ? "copy" : "none";
    };
    const leave = (e: DragEvent) => {
      if (hasFiles(e)) setDepth((d) => Math.max(0, d - 1));
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDepth(0);
      installFiles([...(e.dataTransfer?.files ?? [])]);
    };
    addEventListener("dragenter", enter);
    addEventListener("dragover", over);
    addEventListener("dragleave", leave);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragenter", enter);
      removeEventListener("dragover", over);
      removeEventListener("dragleave", leave);
      removeEventListener("drop", drop);
    };
  }, []);
  if (depth === 0) return null;
  return (
    <div class="drop-overlay" aria-hidden="true">
      <div class="drop-message">
        {deviceReady.value
          ? (
            <>
              <strong>Drop to install on {currentDevice.value?.model ?? "the phone"}</strong>
              <span>APK, or APKS, XAPK and APKM bundles</span>
            </>
          )
          : <strong>Connect a phone to install APKs</strong>}
      </div>
    </div>
  );
}

function NoDevice() {
  const device = currentDevice.value;
  if (device) {
    return (
      <div class="no-device">
        <h1>{device.model ?? device.serial} is not ready</h1>
        <p>{STATE_HELP[device.state] ?? "Reconnect the phone and try again."}</p>
      </div>
    );
  }
  return (
    <div class="no-device">
      <h1>Connect a phone</h1>
      <ol>
        <li>On the phone, open Settings, About phone, and tap Build number seven times.</li>
        <li>In Developer options, turn on USB debugging.</li>
        <li>Plug the phone in and tap Allow on the prompt.</li>
      </ol>
      <p>
        Or{" "}
        <button type="button" class="link" onClick={() => (dialog.value = "pair")}>
          connect over Wi-Fi
        </button>.
        {devices.value.length === 0 && " Backups stay available in the Backups tab."}
      </p>
    </div>
  );
}

export function Shell() {
  return (
    <>
      <TopBar />
      <main class="main">
        {tab.value === "library" ? <LibraryView /> : deviceReady.value ? <AppsView /> : <NoDevice />}
      </main>
      <DropZone />
      <Toasts />
      {installDraft.value && <InstallDialog />}
      {dialog.value === "settings" && <SettingsDialog />}
      {dialog.value === "pair" && <PairDialog />}
      {logcatPackage.value && <LogcatPanel />}
      {confirmRequest.value && <ConfirmDialog />}
    </>
  );
}
