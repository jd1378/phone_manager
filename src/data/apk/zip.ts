// Minimal ZIP reader for APKs and APK bundles: central directory (with ZIP64), stored and deflated
// entries. Encrypted entries are rejected.

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_ID = 0x0001;
const MAX_EOCD_SEARCH = 22 + 0xffff;
const CHUNK = 64 * 1024;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  encrypted: boolean;
}

const u64 = (view: DataView, offset: number) => Number(view.getBigUint64(offset, true));

export class ZipFile {
  private constructor(private readonly file: Deno.FsFile, readonly entries: ZipEntry[]) {}

  static async open(path: string): Promise<ZipFile> {
    const file = await Deno.open(path, { read: true });
    try {
      return new ZipFile(file, await readCentralDirectory(file));
    } catch (error) {
      file.close();
      throw error;
    }
  }

  close(): void {
    this.file.close();
  }

  find(name: string): ZipEntry | undefined {
    return this.entries.find((entry) => entry.name === name);
  }

  async read(entry: ZipEntry): Promise<Uint8Array> {
    return new Uint8Array(await new Response(await this.stream(entry)).arrayBuffer());
  }

  /** Decompressed contents; the stream must be consumed before reading another entry. */
  async stream(entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
    if (entry.encrypted) throw new Error(`${entry.name} is encrypted`);
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error(`${entry.name} uses unsupported compression`);
    }
    const header = await readAt(this.file, entry.localHeaderOffset, 30);
    const view = new DataView(header.buffer);
    if (view.getUint32(0, true) !== LOCAL_SIGNATURE) throw new Error(`Bad local header for ${entry.name}`);
    const start = entry.localHeaderOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
    let position = start;
    const end = start + entry.compressedSize;
    const file = this.file;
    const raw = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (position >= end) return controller.close();
        const chunk = await readAt(file, position, Math.min(CHUNK, end - position));
        position += chunk.length;
        controller.enqueue(chunk);
      },
    });
    return entry.method === 8
      ? raw.pipeThrough(
        new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>,
      )
      : raw;
  }
}

async function readAt(file: Deno.FsFile, offset: number, length: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  await file.seek(offset, Deno.SeekMode.Start);
  let read = 0;
  while (read < length) {
    const n = await file.read(buffer.subarray(read));
    if (n === null) throw new Error("Unexpected end of ZIP file");
    read += n;
  }
  return buffer;
}

async function readCentralDirectory(file: Deno.FsFile): Promise<ZipEntry[]> {
  const size = (await file.stat()).size;
  const tailLength = Math.min(size, MAX_EOCD_SEARCH);
  const tail = await readAt(file, size - tailLength, tailLength);
  const tailView = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tailLength - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file");
  let count = tailView.getUint16(eocd + 10, true);
  let directorySize = tailView.getUint32(eocd + 12, true);
  let directoryOffset = tailView.getUint32(eocd + 16, true);

  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || tailView.getUint32(locator, true) !== ZIP64_LOCATOR_SIGNATURE) {
      throw new Error("Missing ZIP64 locator");
    }
    const record = new DataView((await readAt(file, u64(tailView, locator + 8), 56)).buffer);
    if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) throw new Error("Bad ZIP64 end record");
    count = u64(record, 32);
    directorySize = u64(record, 40);
    directoryOffset = u64(record, 48);
  }

  const directory = await readAt(file, directoryOffset, directorySize);
  const view = new DataView(directory.buffer);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL_SIGNATURE) throw new Error("Corrupt ZIP central directory");
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const entry: ZipEntry = {
      name: decoder.decode(directory.subarray(p + 46, p + 46 + nameLength)),
      method: view.getUint16(p + 10, true),
      encrypted: (view.getUint16(p + 8, true) & 1) !== 0,
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      localHeaderOffset: view.getUint32(p + 42, true),
    };
    // ZIP64 extra field holds, in order, only the fields whose 32-bit value is saturated.
    let extra = p + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === ZIP64_EXTRA_ID) {
        let field = extra + 4;
        if (entry.size === 0xffffffff) {
          entry.size = u64(view, field);
          field += 8;
        }
        if (entry.compressedSize === 0xffffffff) {
          entry.compressedSize = u64(view, field);
          field += 8;
        }
        if (entry.localHeaderOffset === 0xffffffff) entry.localHeaderOffset = u64(view, field);
      }
      extra += 4 + length;
    }
    entries.push(entry);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
