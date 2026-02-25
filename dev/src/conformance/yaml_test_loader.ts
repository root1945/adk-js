/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import camelcaseKeys from 'camelcase-keys';
import fg from 'fast-glob';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {parse} from 'yaml';
import {TestSpec} from '../integration/test_types.js';

/**
 * BatchYamlTestLoader will recursively search the directory given
 * and load all of the YAML files into in-memory config.
 */
export class BatchYamlTestLoader {
  constructor(private readonly directory: string) {}

  async load(): Promise<Map<string, TestSpec>> {
    console.log('Loading tests from ', this.directory);
    // Tests have 3 parts:
    //
    // 1. spec.yaml - the defined test config and input
    // 2. generated-recordings.yaml - the recorded event information
    // 3. generated-session.yaml - the recorded session information
    const files = fg.stream('**/spec.{yaml,yml}', {
      cwd: this.directory,
      absolute: true,
    });
    const tests = new Map<string, TestSpec>();

    for await (const file of files) {
      const filePath = file as string;
      const content = await fs.readFile(filePath, 'utf-8');
      const testSpec = camelcaseKeys(parse(content), {
        deep: true,
      }) as TestSpec;

      // Make test names unique by including relative file path from given root dir
      const relativePath = path.relative(this.directory, filePath);
      const parsedPath = path.parse(relativePath);
      const name = path.join(parsedPath.dir, parsedPath.name);
      tests.set(name, testSpec);

      //console.log('loaded test', name, 'from', filePath);
    }

    return tests;
  }
}
