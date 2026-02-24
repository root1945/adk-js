/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseAgent,
  LlmAgent,
  LoopAgent,
  ParallelAgent,
  SequentialAgent,
} from '@google/adk';
import {YamlAgentConfig} from '../../conformance/yaml_agent_loader.js';
import {IntegrationRegistry} from './integration_registry.js';

export class AgentRegistry {
  private agents = new Map<string, BaseAgent>();
  private configs = new Map<string, YamlAgentConfig>();
  private instantiating = new Set<string>();
  private integrationRegistry: IntegrationRegistry;

  constructor(integrationRegistry: IntegrationRegistry) {
    this.integrationRegistry = integrationRegistry;
  }

  registerAgent(name: string, agent: BaseAgent) {
    this.agents.set(name, agent);
  }

  getAgent(name: string): BaseAgent | undefined {
    if (this.agents.has(name)) {
      return this.agents.get(name);
    }
    if (this.configs.has(name)) {
      return this.instantiateAgent(name, this.configs.get(name)!);
    }
    return undefined;
  }

  registerAgentConfig(name: string, config: YamlAgentConfig) {
    this.configs.set(name, config);
  }

  private instantiateAgent(name: string, config: YamlAgentConfig): BaseAgent {
    console.log(
      'Instantiating ',
      name,
      'of class',
      config.agentClass ?? 'LlmAgent',
    );

    if (this.instantiating.has(name)) {
      throw new Error(`Circular dependency detected for agent ${name}`);
    }
    this.instantiating.add(name);

    try {
      const beforeAgentCallbacks = config.beforeAgentCallbacks?.map(
        (callbackInfo) => {
          const callback = this.integrationRegistry.getBeforeAgentCallback(
            callbackInfo.name,
          );
          if (!callback) {
            throw new Error(
              `BeforeAgentCallback ${callbackInfo.name} not found in registry`,
            );
          }
          return callback;
        },
      );

      const afterAgentCallbacks = config.afterAgentCallbacks?.map(
        (callbackInfo) => {
          const callback = this.integrationRegistry.getAfterAgentCallback(
            callbackInfo.name,
          );
          if (!callback) {
            throw new Error(
              `AfterAgentCallback ${callbackInfo.name} not found in registry`,
            );
          }
          return callback;
        },
      );

      const subAgents = config.subAgents?.map((ref) => {
        const subAgent = this.getAgent(ref.configPath);
        if (!subAgent) {
          throw new Error(
            `SubAgent ${ref.configPath} not found in registry (referenced by ${name})`,
          );
        }
        return subAgent;
      });

      const tools = config.toolsConfiguration?.map((toolConfig) => {
        const tool = this.integrationRegistry.getTool(toolConfig.name);
        if (!tool) {
          throw new Error(`Tool ${toolConfig.name} not found in registry`);
        }
        return tool;
      });

      const options = {
        name: config.name,
        model: config.model,
        description: config.description,
        instruction: config.instruction,
        beforeAgentCallback: beforeAgentCallbacks ?? [],
        afterAgentCallback: afterAgentCallbacks ?? [],
        subAgents: subAgents ?? [],
        tools: tools ?? [],
        disallowTransferToParent: config.disallowTransferToParent === 'true',
        disallowTransferToPeers: config.disallowTransferToPeers === 'true',
        temperature: config.generateContentConfig?.temperature,
      };

      let agent: BaseAgent;
      switch (config.agentClass) {
        case 'LoopAgent':
          agent = new LoopAgent({
            ...options,
            maxIterations: config.maxIterations
              ? parseInt(config.maxIterations, 10)
              : undefined,
          });
          break;
        case 'ParallelAgent':
          agent = new ParallelAgent(options);
          break;
        case 'SequentialAgent':
          agent = new SequentialAgent(options);
          break;
        case 'LlmAgent':
        default:
          agent = new LlmAgent(options);
          break;
      }

      this.registerAgent(name, agent);
      return agent;
    } finally {
      this.instantiating.delete(name);
    }
  }

  summary(): string {
    return `${this.configs.size} configs, ${this.agents.size} instantiated agents`;
  }
}
