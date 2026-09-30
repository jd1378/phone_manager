import { useEffect, useState } from "preact/hooks";
import type { DirectoryListing } from "../../../domain/ports.ts";
import { api } from "../api.ts";
import { adbVersion, describeError, dialog, home, saveSettings, settings, toast } from "../state.ts";
import { Dialog } from "./Dialog.tsx";

/** Browsers cannot hand a folder path to the server, so the server lists folders for us. */
function FolderPicker({ start, onPick }: { start: string; onPick: (path: string) => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const open = (path: string) =>
    api.directories(path).then((l) => {
      setListing(l);
      setError(null);
    }, (e) => setError(describeError(e)));
  useEffect(() => {
    open(start).catch(() => open(home.value));
  }, []);
  const separator = listing?.path.includes("\\") ? "\\" : "/";
  const join = (name: string) => `${listing!.path.replace(/[\\/]$/, "")}${separator}${name}`;

  return (
    <div class="folder-picker">
      <div class="folder-path">
        <button
          type="button"
          disabled={!listing?.parent}
          onClick={() => listing?.parent && open(listing.parent)}
        >
          Up
        </button>
        <button type="button" onClick={() => open(home.value)}>Home</button>
        <span class="mono">{listing?.path}</span>
      </div>
      {error && <p class="error">{error}</p>}
      <ul class="folder-list">
        {listing?.directories.length === 0 && <li class="muted">No folders here</li>}
        {listing?.directories.map((name) => (
          <li key={name}>
            <button type="button" class="link" onClick={() => open(join(name))}>{name}</button>
          </li>
        ))}
      </ul>
      <form
        class="folder-new"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!listing || !newName.trim()) return;
          try {
            await api.createDirectory(join(newName.trim()));
            setNewName("");
            open(join(newName.trim()));
          } catch (error) {
            toast(describeError(error), "error");
          }
        }}
      >
        <input
          placeholder="New folder name"
          aria-label="New folder name"
          value={newName}
          onInput={(e) => setNewName(e.currentTarget.value)}
        />
        <button type="submit" disabled={!newName.trim()}>Create</button>
        <button
          type="button"
          class="primary"
          disabled={!listing}
          onClick={() => listing && onPick(listing.path)}
        >
          Use this folder
        </button>
      </form>
    </div>
  );
}

export function SettingsDialog() {
  const current = settings.value!;
  const [folder, setFolder] = useState(current.backupDirectory);
  const [browsing, setBrowsing] = useState(false);
  const [autoLoad, setAutoLoad] = useState(current.autoLoadMetadata);
  const close = () => (dialog.value = null);
  return (
    <Dialog title="Settings" onClose={close} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await saveSettings({ backupDirectory: folder.trim(), autoLoadMetadata: autoLoad })) close();
        }}
      >
        <div class="dialog-body">
          <label class="field">
            <span>Backup folder</span>
            <span class="field-row">
              <input value={folder} onInput={(e) => setFolder(e.currentTarget.value)} class="mono" required />
              <button type="button" onClick={() => setBrowsing(!browsing)} aria-expanded={browsing}>
                Browse…
              </button>
            </span>
            <small class="muted">Each app gets a folder, with one subfolder per version.</small>
          </label>
          {browsing && (
            <FolderPicker
              start={folder}
              onPick={(path) => {
                setFolder(path);
                setBrowsing(false);
              }}
            />
          )}
          <label class="check-row">
            <input
              type="checkbox"
              checked={autoLoad}
              onChange={(e) => setAutoLoad(e.currentTarget.checked)}
            />
            <span>
              Load app names, icons and sizes automatically
              <small class="muted block">
                Runs a small helper on the phone through adb each time a phone connects. It is not installed
                and does not keep running.
              </small>
            </span>
          </label>
          <p class="muted">{adbVersion.value}</p>
        </div>
        <footer class="dialog-actions">
          <button type="button" onClick={close}>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </footer>
      </form>
    </Dialog>
  );
}
