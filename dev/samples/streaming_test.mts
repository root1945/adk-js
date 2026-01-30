import type {Event, LlmResponse} from '@google/adk';
import {
  BasePlugin,
  CallbackContext,
  FunctionTool,
  InMemorySessionService,
  LlmAgent,
  Runner,
  StreamingMode,
} from '@google/adk';
import {GenerateContentResponse, ThinkingLevel} from '@google/genai';
import dotenv from 'dotenv';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {z} from 'zod';

const envPath = path.join(process.cwd(), 'dev', 'samples', '.env');
console.log('envPath', envPath);
dotenv.config({path: envPath});

console.log('GOOGLE_GENAI_API_KEY', process.env.GOOGLE_GENAI_API_KEY);

function toGenAIResponse(response: LlmResponse): GenerateContentResponse {
  const result = new GenerateContentResponse();

  result.candidates = [
    {
      content: response.content,
      groundingMetadata: response.groundingMetadata,
      finishReason: response.finishReason,
    },
  ];
  result.usageMetadata = response.usageMetadata;

  return result;
}

export class ModelEventCapturePlugin extends BasePlugin {
  private readonly modelResponses: GenerateContentResponse[] = [];

  async afterModelCallback(params: {
    callbackContext: CallbackContext;
    llmResponse: LlmResponse;
  }): Promise<LlmResponse | undefined> {
    this.modelResponses.push(toGenAIResponse(params.llmResponse));
    return params.llmResponse;
  }

  dump(fileName: string): Promise<void> {
    return fs.writeFile(
      path.join(process.cwd(), fileName),
      JSON.stringify(this.modelResponses, null, 2),
    );
  }
}

export class AgentEventCapturePlugin extends BasePlugin {
  private readonly events: Event[] = [];

  async onEventCallback(params: {event: Event}): Promise<Event | undefined> {
    this.events.push(params.event);
    return params.event;
  }

  dump(fileName: string): Promise<void> {
    return fs.writeFile(
      path.join(process.cwd(), fileName),
      JSON.stringify(this.events, null, 2),
    );
  }
}

if (!process.env.GOOGLE_GENAI_API_KEY) {
  throw new Error(
    'GOOGLE_GENAI_API_KEY environment variable is required. Please set it in .env file.',
  );
}

const currentTimeTool = new FunctionTool({
  name: 'get_current_time',
  description: 'Get the current date and time',
  parameters: z.object({}),
  execute: async () => {
    console.log('\n>>> TOOL CALLED: get_current_time <<<\n');
    return new Date().toISOString();
  },
});

async function main() {
  console.log('=== Streaming Mode Bug Reproduction ===');
  console.log('Model: gemini-3-flash-preview');
  console.log('Streaming: ENABLED (SSE)\n');

  const agent = new LlmAgent({
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

  const modelEventCapturePlugin = new ModelEventCapturePlugin('model_events');
  const agentEventCapturePlugin = new AgentEventCapturePlugin('agent_events');

  const sessionService = new InMemorySessionService();
  const session = await sessionService.createSession({
    appName: 'repro',
    userId: 'user1',
  });
  const runner = new Runner({
    agent,
    appName: 'repro',
    sessionService,
    plugins: [modelEventCapturePlugin, agentEventCapturePlugin],
  });

  let toolCallCount = 0;
  let functionResponseCount = 0;
  let textResponseCount = 0;

  try {
    for await (const event of runner.runAsync({
      userId: 'user1',
      sessionId: session.id,
      newMessage: {role: 'user', parts: [{text: 'What time is it?'}]},
      runConfig: {
        streamingMode: StreamingMode.SSE, // ENABLE STREAMING
      },
    })) {
      if (event.content?.parts) {
        for (const part of event.content.parts) {
          if (part.functionCall) {
            toolCallCount++;
            console.log(`[AGENT] Function Call: ${part.functionCall.name}`);
          }
          if (part.functionResponse) {
            functionResponseCount++;
            console.log(`[AGENT] Function Response received`);
          }
          if (part.text && part.text.trim()) {
            textResponseCount++;
            const preview = part.text.substring(0, 60).replace(/\n/g, ' ');
            console.log(
              `[AGENT] Text chunk #${textResponseCount}: ${preview}...`,
            );
          }
        }
      }
    }

    console.log('\n=== RESULTS ===');
    console.log(`Tool Calls: ${toolCallCount}`);
    console.log(`Function Responses: ${functionResponseCount}`);
    console.log(`Text Chunks: ${textResponseCount}`);

    if (toolCallCount > 0 && textResponseCount === 0) {
      console.log(
        '\n[FAIL] BUG REPRODUCED: Tool was called but no synthesis text was generated!',
      );
      console.log('The loop terminated prematurely after tool execution.');
    } else if (toolCallCount > 0 && textResponseCount > 0) {
      console.log('\n[PASS] Tool was called AND synthesis text was generated.');
    } else {
      console.log('\n[WARN] No tools were called - test inconclusive.');
    }
  } catch (error: any) {
    if (error.message === 'TIMEOUT_DETECTED') {
      console.error('\n[TIMEOUT] Agent stalled after tool execution.');
    } else {
      console.error('ERROR:', error);
    }
  } finally {
    modelEventCapturePlugin.dump('streaming_test_model_events.json');
    agentEventCapturePlugin.dump('streaming_test_agent_events.json');
  }
}

main().catch(console.error);
