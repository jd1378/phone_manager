import { join } from "@std/path";
import { AppError } from "../../domain/errors.ts";
import type { InspectedApk, Upload } from "../../domain/models.ts";
import type { UploadStore } from "../../domain/ports.ts";
import { BUNDLE_EXTENSIONS, extractBundle, inspectApk } from "../apk/apk_reader.ts";

export const MAX_UPLOAD_BYTES = 8 * 1024 ** 3;

/** Dropped or picked files, streamed to a private temp directory and inspected. */
export class TempUploadStore implements UploadStore {
  readonly #uploads = new Map<string, { upload: Upload; directory: string }>();

  constructor(private readonly root: string) {}

  async save(name: string, body: ReadableStream<Uint8Array>): Promise<Upload> {
    const lower = name.toLowerCase();
    const isBundle = BUNDLE_EXTENSIONS.some((extension) => lower.endsWith(extension));
    if (!isBundle && !lower.endsWith(".apk")) {
      await body.cancel();
      throw new AppError("invalid-input", "Only .apk, .apks, .xapk and .apkm files can be installed");
    }
    const id = crypto.randomUUID();
    const directory = join(this.root, id);
    await Deno.mkdir(directory, { recursive: true });
    try {
      const received = join(directory, isBundle ? "bundle.zip" : "upload.apk");
      const size = await writeLimited(received, body, MAX_UPLOAD_BYTES);
      let apks: InspectedApk[];
      if (isBundle) {
        const paths = await extractBundle(received, directory).catch((error) => {
          throw new AppError("invalid-input", `Cannot read ${name}: ${error.message}`);
        });
        await Deno.remove(received);
        apks = await Promise.all(paths.map(inspectApk));
      } else {
        apks = [{ ...(await inspectApk(received)), fileName: name }];
      }
      const upload: Upload = { id, name, size, apks };
      this.#uploads.set(id, { upload, directory });
      return upload;
    } catch (error) {
      await Deno.remove(directory, { recursive: true }).catch(() => {});
      throw error;
    }
  }

  get(id: string): Upload | null {
    return this.#uploads.get(id)?.upload ?? null;
  }

  async remove(id: string): Promise<void> {
    const stored = this.#uploads.get(id);
    if (!stored) return;
    this.#uploads.delete(id);
    await Deno.remove(stored.directory, { recursive: true }).catch(() => {});
  }
}

async function writeLimited(path: string, body: ReadableStream<Uint8Array>, limit: number): Promise<number> {
  let size = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) throw new AppError("invalid-input", "File is too large");
      controller.enqueue(chunk);
    },
  });
  const file = await Deno.open(path, { write: true, createNew: true, mode: 0o600 });
  await body.pipeThrough(counter).pipeTo(file.writable);
  return size;
}
