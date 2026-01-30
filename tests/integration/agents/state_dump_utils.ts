import type {Event, LlmResponse, RunConfig} from '@google/adk';
import {
  BasePlugin,
  CallbackContext,
  InMemoryRunner,
  LlmAgent,
} from '@google/adk';
import {GenerateContentResponse, createUserContent} from '@google/genai';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

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

/**
 * A plugin that captures all model responses.
 */
export class ModelEventCapturePlugin extends BasePlugin {
  private readonly fileName: string;
  private readonly modelResponses: GenerateContentResponse[] = [];

  constructor(fileName: string) {
    super('model-event-capture-plugin');
    this.fileName = fileName;
  }

  async afterModelCallback(params: {
    callbackContext: CallbackContext;
    llmResponse: LlmResponse;
  }): Promise<LlmResponse | undefined> {
    this.modelResponses.push(toGenAIResponse(params.llmResponse));
    return params.llmResponse;
  }

  dump(fileName: string = this.fileName): Promise<void> {
    return fs.writeFile(
      path.join(process.cwd(), fileName),
      JSON.stringify(this.modelResponses, null, 2),
    );
  }
}

/**
 * A plugin that captures all agent events.
 */
export class AgentEventCapturePlugin extends BasePlugin {
  private readonly fileName: string;
  private readonly events: Event[] = [];

  constructor(fileName: string) {
    super('agent-event-capture-plugin');
    this.fileName = fileName;
  }

  async onEventCallback(params: {event: Event}): Promise<Event | undefined> {
    this.events.push(params.event);
    return params.event;
  }

  dump(fileName: string = this.fileName): Promise<void> {
    return fs.writeFile(
      path.join(process.cwd(), fileName),
      JSON.stringify(this.events, null, 2),
    );
  }
}

export async function createRunner({
  agent,
  plugins = [],
  runConfig,
}: {
  agent: LlmAgent;
  plugins?: BasePlugin[];
  runConfig?: RunConfig;
}) {
  const userId = 'test_user';
  const appName = agent.name;
  const runner = new InMemoryRunner({agent: agent, appName, plugins});
  const session = await runner.sessionService.createSession({
    appName,
    userId,
  });

  return {
    run(prompt: string): AsyncGenerator<Event, void, undefined> {
      return runner.runAsync({
        userId,
        sessionId: session.id,
        newMessage: createUserContent(prompt),
        runConfig,
      });
    },
  };
}

/**
 * Runs the agent with the given prompt and plugins.
 */
export async function runAndCapture({
  agent,
  prompt,
  capturePlugins,
  runConfig,
}: {
  agent: LlmAgent;
  prompt: string;
  capturePlugins?: BasePlugin[];
  runConfig: RunConfig;
}) {
  if (!capturePlugins) {
    capturePlugins = [
      new ModelEventCapturePlugin('model_responses.json'),
      new AgentEventCapturePlugin('events_1.json'),
    ];
  }

  const runner = await createRunner({
    agent,
    plugins: capturePlugins,
    runConfig,
  });

  try {
    for await (const _e of runner.run(prompt)) {
      // Do nothing. The plugins will capture events and model responses.
    }
  } catch (e: unknown) {
    console.error(e as Error);
  }

  for (const plugin of capturePlugins) {
    (plugin as unknown as {dump: (fileName?: string) => Promise<void>}).dump();
  }
}
