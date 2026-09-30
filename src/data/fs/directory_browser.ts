import { dirname, resolve } from "@std/path";
import { AppError } from "../../domain/errors.ts";
import type { DirectoryBrowser, DirectoryListing } from "../../domain/ports.ts";

export class FsDirectoryBrowser implements DirectoryBrowser {
  constructor(private readonly homePath: string) {}

  home(): string {
    return this.homePath;
  }

  async list(path: string): Promise<DirectoryListing> {
    const absolute = resolve(path || this.homePath);
    const directories: string[] = [];
    try {
      for await (const entry of Deno.readDir(absolute)) {
        if (entry.isDirectory && !entry.name.startsWith(".")) directories.push(entry.name);
      }
    } catch (error) {
      throw new AppError(
        error instanceof Deno.errors.NotFound ? "not-found" : "invalid-input",
        `Cannot open ${absolute}: ${(error as Error).message}`,
      );
    }
    directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    const parent = dirname(absolute);
    return { path: absolute, parent: parent === absolute ? null : parent, directories };
  }

  async create(path: string): Promise<void> {
    try {
      await Deno.mkdir(resolve(path));
    } catch (error) {
      throw new AppError("invalid-input", `Cannot create ${path}: ${(error as Error).message}`);
    }
  }
}
