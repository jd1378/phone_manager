import type { ApkManifest } from "../../domain/models.ts";

// Android binary XML (AXML) chunk types, from frameworks/base/libs/androidfw/ResourceTypes.h
const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const UTF8_FLAG = 0x100;
const NO_INDEX = 0xffffffff;

const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

// android.R.attr ids; attribute names may be stripped by obfuscators, the ids are not.
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;
const ATTR_MIN_SDK = 0x0101020c;
const ATTR_VERSION_CODE_MAJOR = 0x01010576;

type Value = string | number | null;

interface Attribute {
  name: string;
  resourceId: number | null;
  value: Value;
}

function readStringPool(view: DataView, start: number): string[] {
  const count = view.getUint32(start + 8, true);
  const flags = view.getUint32(start + 16, true);
  const stringsStart = start + view.getUint32(start + 20, true);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const strings: string[] = [];
  for (let i = 0; i < count; i++) {
    let offset = stringsStart + view.getUint32(start + 28 + i * 4, true);
    if (utf8) {
      // utf16 length then utf8 length, each 1 or 2 bytes (high bit marks the 2-byte form)
      offset += bytes[offset] & 0x80 ? 2 : 1;
      let length = bytes[offset];
      if (length & 0x80) {
        length = ((length & 0x7f) << 8) | bytes[offset + 1];
        offset += 2;
      } else {
        offset += 1;
      }
      strings.push(new TextDecoder().decode(bytes.subarray(offset, offset + length)));
    } else {
      let length = view.getUint16(offset, true);
      if (length & 0x8000) {
        length = ((length & 0x7fff) << 16) | view.getUint16(offset + 2, true);
        offset += 4;
      } else {
        offset += 2;
      }
      strings.push(new TextDecoder("utf-16le").decode(bytes.subarray(offset, offset + length * 2)));
    }
  }
  return strings;
}

/** Streams start elements with their attributes, in document order. */
function* startElements(data: Uint8Array): Generator<{ name: string; attributes: Attribute[] }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 8 || view.getUint16(0, true) !== RES_XML_TYPE) {
    throw new Error("Not a binary XML file");
  }
  let strings: string[] = [];
  let resourceIds: number[] = [];
  let offset = view.getUint16(2, true);
  while (offset + 8 <= data.byteLength) {
    const type = view.getUint16(offset, true);
    const headerSize = view.getUint16(offset + 2, true);
    const size = view.getUint32(offset + 4, true);
    if (size < 8 || offset + size > data.byteLength) throw new Error("Corrupt binary XML chunk");
    if (type === RES_STRING_POOL_TYPE) {
      strings = readStringPool(view, offset);
    } else if (type === RES_XML_RESOURCE_MAP_TYPE) {
      resourceIds = [];
      for (let p = offset + headerSize; p < offset + size; p += 4) resourceIds.push(view.getUint32(p, true));
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      const ext = offset + headerSize;
      const nameIndex = view.getUint32(ext + 4, true);
      const attributeStart = view.getUint16(ext + 8, true);
      const attributeSize = view.getUint16(ext + 10, true);
      const attributeCount = view.getUint16(ext + 12, true);
      const attributes: Attribute[] = [];
      for (let i = 0; i < attributeCount; i++) {
        const a = ext + attributeStart + i * attributeSize;
        const attrName = view.getUint32(a + 4, true);
        const raw = view.getUint32(a + 8, true);
        const dataType = view.getUint8(a + 15);
        const value = view.getUint32(a + 16, true);
        let parsed: Value = null;
        if (raw !== NO_INDEX) parsed = strings[raw] ?? null;
        else if (dataType === TYPE_STRING) parsed = strings[value] ?? null;
        else if (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX) parsed = value;
        attributes.push({
          name: strings[attrName] ?? "",
          resourceId: attrName < resourceIds.length ? resourceIds[attrName] : null,
          value: parsed,
        });
      }
      yield { name: strings[nameIndex] ?? "", attributes };
    }
    offset += size;
  }
}

function attribute(attributes: Attribute[], name: string, resourceId?: number): Value {
  const found = attributes.find((a) =>
    (resourceId !== undefined && a.resourceId === resourceId) || a.name === name
  );
  return found?.value ?? null;
}

function asInt(value: Value): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

/** Reads the identity fields from a compiled AndroidManifest.xml. */
export function parseManifest(data: Uint8Array): ApkManifest {
  let manifest: ApkManifest | null = null;
  for (const element of startElements(data)) {
    if (element.name === "manifest") {
      const packageName = attribute(element.attributes, "package");
      if (typeof packageName !== "string" || !packageName) throw new Error("Manifest has no package name");
      const major = asInt(attribute(element.attributes, "versionCodeMajor", ATTR_VERSION_CODE_MAJOR)) ?? 0;
      const versionName = attribute(element.attributes, "versionName", ATTR_VERSION_NAME);
      const split = attribute(element.attributes, "split");
      manifest = {
        packageName,
        versionCode: major * 2 ** 32 +
          (asInt(attribute(element.attributes, "versionCode", ATTR_VERSION_CODE)) ?? 0),
        versionName: typeof versionName === "string" ? versionName : null,
        split: typeof split === "string" && split ? split : null,
        minSdk: null,
      };
    } else if (element.name === "uses-sdk" && manifest) {
      manifest.minSdk = asInt(attribute(element.attributes, "minSdkVersion", ATTR_MIN_SDK));
      break;
    } else if (element.name === "application") {
      break;
    }
  }
  if (!manifest) throw new Error("No <manifest> element");
  return manifest;
}
