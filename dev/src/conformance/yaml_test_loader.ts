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

export interface StringPart {
  text?: string;
}

export interface FunctionResponse {
  // The function response can be any kind of object
  response: Map<string, unknown>;
  id: string;
  name: string;
}

export interface FunctionResponsePart {
  function_response: FunctionResponse;
}

export type ContentPart = StringPart | FunctionResponsePart;

export interface Content {
  parts: ContentPart[];
}

// The User message to replay. Either text or content will be filled in
export interface UserMessage {
  //The user message in text.
  text?: string;
  // The user message in types.Content.
  content?: Content;
}

export interface TestSpec {
  // Human-readable description of what this test validates.
  description: string;
  // Name of the ADK agent to test against.
  agent: string;
  // The initial state key-value pairs in the creation_session request.
  // State could be string, numbers, objects, anything.
  initialState?: Record<string, unknown>;
  // Sequence of user messages to send to the agent during test execution.
  userMessages?: UserMessage[];
}

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
