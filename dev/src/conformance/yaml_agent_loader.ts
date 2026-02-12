/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import camelcaseKeys from 'camelcase-keys';
import fg from 'fast-glob';
import * as fs from 'node:fs/promises';
import {parse} from 'yaml';

/**
 * Define the YAML structure interfaces. These are derived from the existing YAML files.
 */
enum AgentClass {
  LlmAgent = 'LlmAgent',
  LoopAgent = 'LoopAgent',
  ParallelAgent = 'ParallelAgent',
  SequentialAgent = 'SequentialAgent',
}

interface GenerateContentConfig {
  temperature?: number;
}

interface AgentReference {
  configPath: string;
}

interface StdioConnectionParams {
  timeout: number;
}

interface McpServerParams {
  command: string;
  args?: string[];
}

interface McpToolsetArgs {
  stdioConnectionParams: StdioConnectionParams;
  serverParams?: McpServerParams;
  toolFilter?: string[];
}

interface IoPart {
  text: string;
}

interface IoParts {
  parts: IoPart[];
  role: string;
}

interface ExampleIo {
  input: IoParts;
  output: IoParts;
}

interface ExampleConfig {
  examples: ExampleIo[];
}

interface ExampleToolArgs {
  examples: ExampleConfig[];
}

interface LroFuncConfig {
  type: string;
  description: string;
}

interface LongRunningFunctionToolArgs {
  func: LroFuncConfig;
}

interface ToolsConfiguration {
  name: string;
  args:
    | AgentReference
    | McpToolsetArgs
    | ExampleToolArgs
    | LongRunningFunctionToolArgs;
}

// Main config interface
export interface YamlAgentConfig {
  agentClass: AgentClass;
  name: string;
  model: string;
  description: string;
  instruction: string;
  maxIterations?: string;
  disallowTransferToParent?: string;
  disallowTransferToPeers?: string;
  generateContentConfig?: GenerateContentConfig;
  beforeAgentCallbacks?: string[];
  afterAgentCallbacks?: string[];
  subAgents?: AgentReference[];
  toolsConfiguration?: ToolsConfiguration[];
}

/**
 * BatchYamlAgentLoader will recursively search the directory given
 * and load all of the YAML files into in-memory config.
 */
export class BatchYamlAgentLoader {
  constructor(private readonly directory: string) {}

  async load(): Promise<YamlAgentConfig[]> {
    console.log('Loading agents from ', this.directory);
    const files = fg.stream('**/*.{yaml,yml}', {
      cwd: this.directory,
      absolute: true,
    });
    const agents: YamlAgentConfig[] = [];

    for await (const file of files) {
      // console.log(file);
      const content = await fs.readFile(file, 'utf-8');
      const agent = camelcaseKeys(parse(content), {
        deep: true,
      }) as YamlAgentConfig;
      agents.push(agent);
    }

    return agents;
  }
}
