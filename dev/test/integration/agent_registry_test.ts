/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {LlmAgent, SingleAgentCallback} from '@google/adk';
import {beforeEach, describe, expect, it} from 'vitest';
import {AgentRegistry} from '../../src/cli/integration/agent_registry.js';
import {IntegrationRegistry} from '../../src/cli/integration/integration_registry.js';
import {YamlAgentConfig} from '../../src/conformance/yaml_agent_loader.js';

describe('AgentRegistry', () => {
  let integrationRegistry: IntegrationRegistry;
  let agentRegistry: AgentRegistry;

  beforeEach(() => {
    integrationRegistry = new IntegrationRegistry();
    agentRegistry = new AgentRegistry(integrationRegistry);
  });

  it('should register and retrieve an agent', () => {
    const agent = new LlmAgent({
      name: 'test_agent',
      model: 'test_model',
      description: 'test description',
      instruction: 'test instruction',
      beforeAgentCallback: [],
      afterAgentCallback: [],
    });

    agentRegistry.registerAgent('test_agent', agent);
    const retrieved = agentRegistry.getAgent('test_agent');

    expect(retrieved).toBe(agent);
    expect(agentRegistry.getAgent('non_existent')).toBeUndefined();
  });

  it('should register an agent from config', () => {
    const config = {
      name: 'config_agent',
      model: 'config_model',
      description: 'config description',
      instruction: 'config instruction',
      agentClass: 'LlmAgent',
    } as unknown as YamlAgentConfig;

    agentRegistry.registerAgentFromConfig('config_agent', config);
    const retrieved = agentRegistry.getAgent('config_agent');

    expect(retrieved).toBeDefined();
    expect(retrieved).toBeInstanceOf(LlmAgent);
    if (retrieved) {
      expect(retrieved.name).toBe('config_agent');
    }
  });

  it('should register an agent from config with callbacks', () => {
    const beforeCallback: SingleAgentCallback = async () => undefined;
    const afterCallback: SingleAgentCallback = async () => undefined;

    integrationRegistry.registerBeforeAgentCallback(
      'before_cb',
      beforeCallback,
    );
    integrationRegistry.registerAfterAgentCallback('after_cb', afterCallback);

    const config = {
      name: 'callback_agent',
      model: 'model',
      description: 'desc',
      instruction: 'inst',
      agentClass: 'LlmAgent',
      beforeAgentCallbacks: [{name: 'before_cb'}],
      afterAgentCallbacks: [{name: 'after_cb'}],
    } as unknown as YamlAgentConfig;

    agentRegistry.registerAgentFromConfig('callback_agent', config);
    const retrieved = agentRegistry.getAgent('callback_agent');

    expect(retrieved).toBeDefined();
  });

  it('should throw error if before callback is missing', () => {
    const config = {
      name: 'bad_agent',
      model: 'model',
      description: 'desc',
      instruction: 'inst',
      agentClass: 'LlmAgent',
      beforeAgentCallbacks: [{name: 'missing_cb'}],
    } as unknown as YamlAgentConfig;

    expect(() =>
      agentRegistry.registerAgentFromConfig('bad_agent', config),
    ).toThrow('BeforeAgentCallback missing_cb not found in registry');
  });

  it('should throw error if after callback is missing', () => {
    const config = {
      name: 'bad_agent',
      model: 'model',
      description: 'desc',
      instruction: 'inst',
      agentClass: 'LlmAgent',
      afterAgentCallbacks: [{name: 'missing_cb'}],
    } as unknown as YamlAgentConfig;

    expect(() =>
      agentRegistry.registerAgentFromConfig('bad_agent', config),
    ).toThrow('AfterAgentCallback missing_cb not found in registry');
  });
});
