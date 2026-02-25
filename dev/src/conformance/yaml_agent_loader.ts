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
import {YamlAgentConfig} from '../integration/agent_types.js';

/**
 * BatchYamlAgentLoader will recursively search the directory given
 * and load all of the YAML files into in-memory config.
 */
export class BatchYamlAgentLoader {
  constructor(private readonly directory: string) {}

  async load(): Promise<Map<string, YamlAgentConfig>> {
    console.log('Loading agents from ', this.directory);
    const files = fg.stream('**/*.{yaml,yml}', {
      cwd: this.directory,
      absolute: true,
    });
    const agents = new Map<string, YamlAgentConfig>();

    for await (const file of files) {
      const filePath = file as string;
      const content = await fs.readFile(filePath, 'utf-8');
      const agent = camelcaseKeys(parse(content), {
        deep: true,
      }) as YamlAgentConfig;

      // Make agent names unique by including relative file path from given root dir
      const relativePath = path.relative(this.directory, filePath);
      const parsedPath = path.parse(relativePath);
      const name = path.join(parsedPath.dir, parsedPath.name);
      agents.set(name, agent);
    }

    // Update subagent to correctly point to the sibling file names
    for (const [name, agent] of agents) {
      if (agent.subAgents) {
        for (const subAgent of agent.subAgents) {
          const dir = path.dirname(name);
          const subAgentPath = path.join(dir, subAgent.configPath);
          const parsed = path.parse(subAgentPath);
          subAgent.configPath = path.join(parsed.dir, parsed.name);
        }
      }
    }

    return agents;
  }
}
