/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import {
  AbstractBucketArtifactService,
  FileMetadata,
} from './bucket_artifact_service.js';

/**
 * Artifact service that uses the local file system.
 */
export class FileArtifactService extends AbstractBucketArtifactService {
  constructor(rootDirOrUri: string) {
    super(new FileStorageBucket(rootDirOrUri));
  }
}

/**
 * Options for saving a file.
 */
interface SaveOptions {
  contentType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Replicates the @google-cloud/storage Bucket API for local file system.
 */
export class FileStorageBucket {
  private readonly rootDir: string;

  constructor(rootDirOrUri: string) {
    let finalPath = rootDirOrUri;
    if (rootDirOrUri.startsWith('file://')) {
      try {
        finalPath = fileURLToPath(rootDirOrUri);
      } catch (_e: unknown) {
        // Fallback or handle invalid URI
      }
    }
    this.rootDir = path.resolve(finalPath);
  }

  /**
   * Returns a reference to a file.
   * @param filePath The relative path to the file within the bucket.
   */
  file(filePath: string): ArtifactFile {
    return new ArtifactFile(this.rootDir, filePath);
  }

  /**
   * Lists files matching a given prefix.
   */
  async getFiles(options?: {prefix?: string}): Promise<[ArtifactFile[]]> {
    const prefix = options?.prefix || '';
    const prefixDir = path.join(this.rootDir, path.dirname(prefix));

    if (!prefixDir.startsWith(this.rootDir)) {
      throw new Error(`Invalid prefix path escaping root: ${prefix}`);
    }

    return [await listArtifactFiles(prefix, prefixDir, this.rootDir)];
  }
}

async function listArtifactFiles(
  prefix: string,
  dir: string,
  rootDir: string,
): Promise<ArtifactFile[]> {
  try {
    const entries = await fs.readdir(dir, {withFileTypes: true});

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return await listArtifactFiles(prefix, fullPath, rootDir);
      }

      if (entry.isFile()) {
        const files: ArtifactFile[] = [];
        if (entry.name.endsWith('.metadata.json')) {
          continue;
        }

        const relPath = path.relative(rootDir, fullPath);
        const posixPath = toPosixPath(relPath);
        if (posixPath.startsWith(prefix)) {
          files.push(new ArtifactFile(rootDir, posixPath));
        }

        return files;
      }
    }
  } catch (e: unknown) {
    if ((e as {code?: string}).code !== 'ENOENT') {
      throw e;
    }
  }

  return [];
}

/**
 * Replicates the @google-cloud/storage File API for local file system.
 */
export class ArtifactFile {
  public readonly name: string;
  private readonly rootDir: string;
  private readonly fullPath: string;

  constructor(rootDir: string, name: string) {
    this.rootDir = rootDir;
    this.name = name;
    this.fullPath = path.join(rootDir, name);

    if (!this.fullPath.startsWith(this.rootDir)) {
      throw new Error(`Invalid file path escaping root: ${name}`);
    }
  }

  /**
   * Saves data to the file.
   */
  async save(data: string | Buffer, options?: SaveOptions): Promise<void> {
    await fs.mkdir(path.dirname(this.fullPath), {recursive: true});

    if (typeof data === 'string') {
      await fs.writeFile(this.fullPath, data, 'utf-8');
    } else {
      await fs.writeFile(this.fullPath, data);
    }

    const metadata: FileMetadata = {
      contentType: options?.contentType,
      metadata: options?.metadata,
    };

    await fs.writeFile(
      this.getMetadataPath(),
      JSON.stringify(metadata, null, 2),
      'utf-8',
    );
  }

  /**
   * Downloads the file contents.
   */
  async download(): Promise<[Buffer]> {
    try {
      const data = await fs.readFile(this.fullPath);
      return [data];
    } catch (e: unknown) {
      if ((e as {code?: string}).code === 'ENOENT') {
        throw new Error(`File not found: ${this.name}`);
      }
      throw e;
    }
  }

  /**
   * Retrieves the file's metadata.
   */
  async getMetadata(): Promise<[FileMetadata]> {
    try {
      const data = await fs.readFile(this.getMetadataPath(), 'utf-8');
      return [JSON.parse(data) as FileMetadata];
    } catch (e: unknown) {
      if ((e as {code?: string}).code === 'ENOENT') {
        throw new Error(`File not found: ${this.name}`);
      }
      throw e;
    }
  }

  /**
   * Deletes the file and its metadata.
   */
  async delete(): Promise<void> {
    try {
      await fs.rm(this.fullPath, {force: true});
    } catch (e: unknown) {
      throw new Error(`Failed to delete file: ${e}`);
    }

    try {
      await fs.rm(this.getMetadataPath(), {force: true});
    } catch (e: unknown) {
      throw new Error(`Failed to delete metadata file: ${e}`);
    }

    let currentDir = path.dirname(this.fullPath);
    while (currentDir !== this.rootDir) {
      try {
        await fs.rmdir(currentDir);
        currentDir = path.dirname(currentDir);
      } catch (_e: unknown) {
        // Stop if not empty or other error
        break;
      }
    }
  }

  /**
   * Returns a canonically formatted file:// URI.
   */
  publicUrl(): string {
    return pathToFileURL(this.fullPath).toString();
  }

  private getMetadataPath(): string {
    return this.fullPath + '.metadata.json';
  }
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
