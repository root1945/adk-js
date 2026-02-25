/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FileArtifactService} from '@google/adk';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {describe, expect, it} from 'vitest';
import {FileStorageBucket} from '../../src/artifacts/file_artifact_service.js';
import {runArtifactServiceTests} from './artifact_service_test_utils.js';

describe('FileArtifactService', () => {
  let rootDir: string;

  runArtifactServiceTests(
    async () => {
      rootDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'adk-file-artifacts-test-'),
      );
      console.log('rootDir', rootDir);
      await fs.mkdir(rootDir, {recursive: true});
      return new FileArtifactService(rootDir);
    },
    async () => {
      // if (rootDir) {
      //   await fs.rm(rootDir, {recursive: true, force: true});
      // }
    },
  );

  describe('path security', () => {
    it('rejects traversal attempts', async () => {
      rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adk-artifacts-test-'));
      const service = new FileArtifactService(rootDir);
      const appName = 'test-app';
      const userId = 'test-user';
      const sessionId = 'test-session';

      try {
        await service.saveArtifact({
          appName,
          userId,
          sessionId,
          filename: '../../secret.txt',
          artifact: {text: '.'},
        });
        expect.fail('Should have thrown');
      } catch (e: unknown) {
        expect((e as Error).message).toContain('escapes storage directory');
      } finally {
        await fs.rm(rootDir, {recursive: true, force: true});
      }
    });
  });

  describe('FileStorageBucket', () => {
    describe('Storage', () => {
      it('creates a bucket', () => {
        const bucket = new FileStorageBucket(rootDir);
        expect(bucket).toBeDefined();
      });
    });

    describe('Bucket', () => {
      it('creates a file', () => {
        const bucket = new FileStorageBucket(rootDir);
        const file = bucket.file('foo/bar.txt');
        expect(file).toBeDefined();
        expect(file.name).toBe('foo/bar.txt');
      });

      it('lists files with prefix', async () => {
        const bucket = new FileStorageBucket(rootDir);

        // Create some files
        await bucket.file('test1.txt').save('content1');
        await bucket.file('dir/test2.txt').save('content2');
        await bucket.file('dir/test3.txt').save('content3');

        const [allFiles] = await bucket.getFiles();
        expect(allFiles.length).toBe(3);

        const [dirFiles] = await bucket.getFiles({prefix: 'dir/'});
        expect(dirFiles.length).toBe(2);
        expect(dirFiles.map((f) => f.name).sort()).toEqual([
          'dir/test2.txt',
          'dir/test3.txt',
        ]);
      });

      it('returns empty array if prefix does not exist', async () => {
        const bucket = new FileStorageBucket(rootDir);
        const [files] = await bucket.getFiles({prefix: 'nonexistent/'});
        expect(files).toEqual([]);
      });

      it('rejects escaping bucket directory for prefix', async () => {
        const bucket = new FileStorageBucket(rootDir);
        await expect(bucket.getFiles({prefix: '../escape'})).rejects.toThrow();
      });
    });

    describe('File', () => {
      it('saves and downloads string content', async () => {
        const bucket = new FileStorageBucket(rootDir);
        const file = bucket.file('hello.txt');

        await file.save('hello world', {
          contentType: 'text/plain',
          metadata: {custom: 'value'},
        });

        const [data] = await file.download();
        expect(data.toString('utf-8')).toBe('hello world');

        const [metadata] = await file.getMetadata();
        expect(metadata.contentType).toBe('text/plain');
        expect(metadata.metadata).toEqual({custom: 'value'});
      });

      it('saves and downloads buffer content', async () => {
        const bucket = new FileStorageBucket(rootDir);
        const file = bucket.file('data.bin');
        const buf = Buffer.from('binary data');

        await file.save(buf, {contentType: 'application/octet-stream'});

        const [data] = await file.download();
        expect(data).toEqual(buf);

        const [metadata] = await file.getMetadata();
        expect(metadata.contentType).toBe('application/octet-stream');
      });

      it('deletes file and metadata, and cleans up dirs', async () => {
        const bucket = new FileStorageBucket(rootDir);
        const file = bucket.file('deep/dir/file.txt');

        await file.save('content');
        await expect(file.download()).resolves.toBeDefined();

        await file.delete();

        await expect(file.download()).rejects.toThrow('File not found');

        // Check that the directory was cleaned up
        const dirStat = await fs
          .stat(path.join(rootDir, 'deep'))
          .catch((e) => e.code);
        expect(dirStat).toBe('ENOENT');
      });

      it('rejects escaping files', () => {
        const bucket = new FileStorageBucket(rootDir);
        expect(() => bucket.file('../../escape.txt')).toThrow();
      });
    });
  });
});
