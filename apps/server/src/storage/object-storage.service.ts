import { Injectable, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export interface StoredObject {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
}

export interface LocalObject {
  absolutePath: string;
  sizeBytes: number;
}

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

@Injectable()
export class ObjectStorageService implements OnModuleInit {
  readonly driver = process.env.STORAGE_DRIVER ?? "local";
  private readonly root = this.resolveRoot();

  async onModuleInit(): Promise<void> {
    if (this.driver !== "local") {
      throw new Error(`Unsupported STORAGE_DRIVER: ${this.driver}. This release supports local storage.`);
    }
    await mkdir(this.root, { recursive: true });
  }

  async putFile(objectKey: string, sourcePath: string): Promise<StoredObject> {
    const destination = this.resolveObjectPath(objectKey);
    const temporaryDestination = `${destination}.part-${randomUUID()}`;
    await mkdir(dirname(destination), { recursive: true });

    const digest = createHash("sha256");
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        digest.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        createReadStream(sourcePath),
        hashingStream,
        createWriteStream(temporaryDestination, { flags: "wx" }),
      );
      await rename(temporaryDestination, destination);
      const information = await stat(destination);
      return { objectKey, sha256: digest.digest("hex"), sizeBytes: information.size };
    } catch (error) {
      await rm(temporaryDestination, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.resolveObjectPath(objectKey), { force: true });
  }

  async getLocalObject(objectKey: string): Promise<LocalObject> {
    const absolutePath = this.resolveObjectPath(objectKey);
    const information = await stat(absolutePath);
    if (!information.isFile()) throw new Error("Stored object is not a file");
    return { absolutePath, sizeBytes: information.size };
  }

  private resolveRoot(): string {
    const configured = process.env.STORAGE_LOCAL_PATH?.trim();
    if (!configured) return resolve(repositoryRoot, "storage", "objects");
    return isAbsolute(configured) ? resolve(configured) : resolve(repositoryRoot, configured);
  }

  private resolveObjectPath(objectKey: string): string {
    if (!objectKey || objectKey.includes("\0") || objectKey.includes("\\") || isAbsolute(objectKey)) {
      throw new Error("Invalid object key");
    }
    const destination = resolve(this.root, objectKey);
    const pathFromRoot = relative(this.root, destination);
    if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
      throw new Error("Object key resolves outside storage root");
    }
    return destination;
  }
}
