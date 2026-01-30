/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Event} from '@google/adk';
import {StreamingMode} from '@google/adk';
import {describe, it} from 'vitest';
import {RawGenerateContentResponse, runTestCase} from '../test_case_utils.js';
import {rootAgent} from './agent.mjs';
import turn1ExpectedEvents from './events_1.json' with {type: 'json'};
import modelResponses from './model_responses.json' with {type: 'json'};

const testCase = {
  agent: rootAgent,
  turns: [
    {
      userPrompt: 'What time is it?',
      expectedEvents: turn1ExpectedEvents as Event[],
    },
  ],
  modelResponses: modelResponses as RawGenerateContentResponse[],
};

describe('Simple LlmAgent with tools', () => {
  it('should process model response and produce events', async () => {
    await runTestCase(testCase, {
      streamingMode: StreamingMode.SSE,
    });
  });
});
