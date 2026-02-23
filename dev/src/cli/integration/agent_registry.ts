/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {BaseAgent, LlmAgent} from '@google/adk';
import {YamlAgentConfig} from '../../conformance/yaml_agent_loader.js';
import {IntegrationRegistry} from './integration_registry.js';

export class AgentRegistry {
  private agents = new Map<string, BaseAgent>();
  private integrationRegistry: IntegrationRegistry;

  constructor(integrationRegistry: IntegrationRegistry) {
    this.integrationRegistry = integrationRegistry;
  }

  registerAgent(name: string, agent: BaseAgent) {
    this.agents.set(name, agent);
  }

  getAgent(name: string): BaseAgent | undefined {
    return this.agents.get(name);
  }

  registerAgentFromConfig(name: string, config: YamlAgentConfig) {
    console.log('Inflating ', name);

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

    const agent = new LlmAgent({
      name: config.name,
      model: config.model,
      description: config.description,
      instruction: config.instruction,
      beforeAgentCallback: beforeAgentCallbacks ?? [],
      afterAgentCallback: afterAgentCallbacks ?? [],
    });

    this.registerAgent(name, agent);
  }

  summary(): string {
    return `${this.agents.size} agents`;
  }
}
