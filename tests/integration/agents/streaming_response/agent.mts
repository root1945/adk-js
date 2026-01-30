import {FunctionTool, LlmAgent, StreamingMode} from '@google/adk';
import {ThinkingLevel} from '@google/genai';
import {z} from 'zod';

import {runAndCapture} from '../state_dump_utils.ts';

const currentTimeTool = new FunctionTool({
  name: 'get_current_time',
  description: 'Get the current date and time',
  parameters: z.object({}),
  execute: async () => {
    return new Date().toISOString();
  },
});

export const rootAgent = new LlmAgent({
  name: 'streaming_repro_agent',
  model: 'gemini-3-flash-preview',
  generateContentConfig: {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.HIGH,
      includeThoughts: true,
    },
  },
  instruction: 'You MUST use the get_current_time tool to answer.',
  tools: [currentTimeTool],
});

async function main() {
  await runAndCapture({
    agent: rootAgent,
    prompt: 'What time is it?',
    runConfig: {
      streamingMode: StreamingMode.SSE,
    },
  });
}

main();
