import type { App } from "../../../domain/models.ts";
import { api } from "../api.ts";

export function AppIcon({ serial, app, size = 32 }: { serial: string; app: App; size?: number }) {
  if (app.metadata?.hasIcon) {
    return (
      <img
        class="app-icon"
        src={api.iconUrl(serial, app.packageName, app.versionCode)}
        width={size}
        height={size}
        loading="lazy"
        alt=""
      />
    );
  }
  // com.whatsapp -> W: the second segment usually names the vendor or product.
  const source = app.metadata?.label ?? app.packageName.split(".")[1] ?? app.packageName;
  const letter = source[0]?.toUpperCase() ?? "?";
  return (
    <span class="app-icon app-icon-empty" aria-hidden="true" style={{ width: size, height: size }}>
      {letter}
    </span>
  );
}
