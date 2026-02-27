/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Define the YAML structure interfaces. These are derived from the existing YAML files.
 */
export enum AgentClass {
  LlmAgent = 'LlmAgent',
  LoopAgent = 'LoopAgent',
  ParallelAgent = 'ParallelAgent',
  SequentialAgent = 'SequentialAgent',
}

export interface GenerateContentConfig {
  temperature?: number;
}

export interface CallbackInfo {
  name: string;
}

export interface AgentReference {
  configPath: string;
}

export interface AgentToolArgs {
  agent: AgentReference;
}

export interface StdioConnectionParams {
  timeout: number;
}

export interface McpServerParams {
  command: string;
  args?: string[];
}

export interface McpToolsetArgs {
  stdioConnectionParams: StdioConnectionParams;
  serverParams?: McpServerParams;
  toolFilter?: string[];
}

export interface IoPart {
  text: string;
}

export interface IoParts {
  parts: IoPart[];
  role: string;
}

export interface ExampleIo {
  input: IoParts;
  output: IoParts;
}

export interface ExampleConfig {
  examples: ExampleIo[];
}

export interface ExampleToolArgs {
  examples: ExampleConfig[];
}

export interface LroFuncConfig {
  type: string;
  description: string;
}

export interface LongRunningFunctionToolArgs {
  func: LroFuncConfig;
}

export interface ToolsConfiguration {
  name: string;
  args?:
    | AgentToolArgs
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
  beforeAgentCallbacks?: CallbackInfo[];
  afterAgentCallbacks?: CallbackInfo[];
  subAgents?: AgentReference[];
  tools?: ToolsConfiguration[];
}
