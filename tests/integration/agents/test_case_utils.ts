/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BasePlugin,
  DatabaseSessionService,
  Event,
  Gemini,
  InMemoryRunner,
  isLlmAgent,
  LlmAgent,
  LlmAgentConfig,
} from '@google/adk';
import {
  Candidate,
  createUserContent,
  GenerateContentResponse,
  GoogleGenAI,
  UsageMetadata,
} from '@google/genai';
import {SqliteDriver} from '@mikro-orm/sqlite';
import {spawn} from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {expect} from 'vitest';
import {AdkApiClient} from '../../../dev/src/server/adk_api_client.js';

/**
 * Represents a raw generate content response.
 */
export interface RawGenerateContentResponse {
  candidates?: Candidate[];
  usageMetadata?: UsageMetadata;
}

/**
 * Represents a turn in a test case.
 */
export interface TestCaseTurn {
  userPrompt: string;
  expectedEvents: Event[];
}

/**
 * Represents a test case for an agent.
 */
export interface TestCase {
  agent: LlmAgent | LlmAgentConfig;
  turns: TestCaseTurn[];
  modelResponses: RawGenerateContentResponse[];
}

function toGenerateContentResponse(
  raw: RawGenerateContentResponse,
): GenerateContentResponse {
  const response = new GenerateContentResponse();
  response.candidates = raw.candidates;
  response.usageMetadata = raw.usageMetadata;

  return response;
}

class MockModels {
  private responseIndex = 0;

  constructor(private readonly responses: GenerateContentResponse[]) {}

  async generateContent(_req: unknown): Promise<GenerateContentResponse> {
    return this.getNextResponse();
  }

  async generateContentStream(
    _req: unknown,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const response = this.getNextResponse();
    // Use an IIFE to create the async generator
    return (async function* () {
      yield response;
    })();
  }

  private getNextResponse(): GenerateContentResponse {
    if (this.responseIndex >= this.responses.length) {
      throw new Error(
        `No more recorded responses available. Requested ${
          this.responseIndex + 1
        }, but only have ${this.responses.length}.`,
      );
    }
    return this.responses[this.responseIndex++];
  }
}

class MockGenAIClient {
  public models: MockModels;
  public vertexai = false;

  constructor(responses: GenerateContentResponse[]) {
    this.models = new MockModels(responses);
  }
}

/**
 * A mock implementation of Gemini that returns predefined responses.
 */
export class GeminiWithMockResponses extends Gemini {
  private readonly _mockClient: MockGenAIClient;

  constructor(responses: RawGenerateContentResponse[]) {
    super({apiKey: 'test-key'});
    this._mockClient = new MockGenAIClient(
      responses.map(toGenerateContentResponse),
    );
  }

  override get apiClient(): GoogleGenAI {
    return this._mockClient as unknown as GoogleGenAI;
  }
}

/**
 * Creates a runner for the given agent.
 * @param agent The agent to create a runner for.
 * @returns A runner for the given agent.
 */
export async function createRunner(
  agent: LlmAgent,
  plugins: BasePlugin[] = [],
) {
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
      });
    },
  };
}

const ADK_EVENT_ID_REGEX = /^[a-zA-Z0-9]{8}$/;
const INVOCATION_ID_REGEX =
  /^e-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Asserts that an event matches an expected event shape, pruning non-deterministic fields.
 */
export function assertEventMatches(
  event: Event,
  expectedEvent: Partial<Event>,
) {
  expect(event.id).toMatch(ADK_EVENT_ID_REGEX);
  if (event.invocationId) {
    expect(event.invocationId).toMatch(INVOCATION_ID_REGEX);
  }
  expect(event.timestamp).toBeGreaterThan(0);

  // Prune random fields from expected event
  delete (expectedEvent as {id?: string}).id;
  delete (expectedEvent as {invocationId?: string}).invocationId;
  delete (expectedEvent as {timestamp?: number}).timestamp;
  delete (expectedEvent as {finishReason?: string}).finishReason;

  expect(event).toMatchObject(expectedEvent);
}

/**
 * Runs the given test case via direct runner.
 * @param testCase The test case to run.
 */
export async function runTestCase(testCase: TestCase) {
  const agent = isLlmAgent(testCase.agent)
    ? testCase.agent
    : new LlmAgent(testCase.agent);
  agent.model = new GeminiWithMockResponses(testCase.modelResponses);
  const runner = await createRunner(agent);

  for (const turn of testCase.turns) {
    let eventIndex = 0;

    for await (const event of runner.run(turn.userPrompt)) {
      expect(eventIndex < turn.expectedEvents.length).toBe(true);
      const expectedEvent = turn.expectedEvents[eventIndex];

      assertEventMatches(event, expectedEvent!);

      eventIndex++;
    }
  }
}

/**
 * Starts an ADK API Server within a child process via CLI for a given agent directory.
 */
export async function startApiServer(agentDir: string, dbPath: string) {
  const port = 40000 + Math.floor(Math.random() * 10000);
  const cliPath = path.resolve(__dirname, '../../../dev/dist/cli/cli.mjs');
  const serverProcess = spawn('node', [
    cliPath,
    'api_server',
    agentDir,
    '--port',
    port.toString(),
    '--session_service_uri',
    `sqlite:///${dbPath}`,
  ]);

  return {
    port,
    start: async () => {
      await new Promise<void>((resolve, reject) => {
        let started = false;
        serverProcess.stdout.on('data', (data) => {
          const message = data.toString();
          if (message.includes('ADK Web Server started')) {
            started = true;
            resolve();
          }
        });
        serverProcess.stderr.on('data', (data) => {
          console.error(`CLI Stderr: ${data.toString()}`);
        });
        serverProcess.on('exit', (code) => {
          if (!started)
            reject(new Error(`Server exited prematurely with code ${code}`));
        });
        setTimeout(() => {
          if (!started)
            reject(new Error('Timeout waiting for server to start.'));
        }, 10000);
      });

      return new AdkApiClient({backendUrl: `http://localhost:${port}`});
    },
    stop: async () => {
      if (serverProcess) {
        serverProcess.kill('SIGINT');
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    },
  };
}

/**
 * Runs a test case by pushing messages to a provided AdkApiClient interacting with a CLI backend.
 */
export async function runTestCaseAgainstApiServer(
  testCase: TestCase,
  agentDir: string,
  appName: string,
) {
  const userId = 'test_user';
  const dbPath = path.join(
    os.tmpdir(),
    `adk_test_${crypto.randomUUID()}.sqlite`,
  );

  const server = await startApiServer(agentDir, dbPath);
  const apiClient = await server.start();

  try {
    const session = await apiClient.createSession({appName, userId});

    for (const turn of testCase.turns) {
      const events: Event[] = [];
      for await (const e of apiClient.runAsync({
        appName,
        userId,
        sessionId: session.id,
        newMessage: turn.userPrompt,
        streaming: true,
        stateDelta: {},
      })) {
        events.push(e);
      }

      const finalEvents = events.filter((e) => {
        if ((e as unknown as {partial?: boolean}).partial === true) {
          return false;
        }
        return true;
      });

      expect(finalEvents.length).toBe(turn.expectedEvents.length);
      for (let i = 0; i < finalEvents.length; i++) {
        assertEventMatches(
          finalEvents[i]!,
          turn.expectedEvents[i]! as Partial<Event>,
        );
      }
    }

    // Verify session state was correctly persisted to SQLite
    const dbSessionService = new DatabaseSessionService({
      dbName: dbPath,
      driver: SqliteDriver,
      allowGlobalContext: true,
    });

    const reloadedSession = await dbSessionService.getSession({
      appName,
      userId,
      sessionId: session.id,
    });

    expect(reloadedSession).toBeDefined();

    const reloadedEvents = reloadedSession!.events;

    let expectedLength = 1; // initial user prompt
    for (const turn of testCase.turns) {
      expectedLength += turn.expectedEvents.length;
    }
    // plus subsequent user prompts
    expectedLength += testCase.turns.length - 1;

    expect(reloadedEvents.length).toBe(expectedLength);

    let offset = 0;
    for (let turnIdx = 0; turnIdx < testCase.turns.length; turnIdx++) {
      const turn = testCase.turns[turnIdx]!;
      expect(reloadedEvents[offset]!.author).toBe('user');
      expect(reloadedEvents[offset]!.content!.parts![0]!.text).toBe(
        turn.userPrompt,
      );
      offset += 1;

      for (let i = 0; i < turn.expectedEvents.length; i++) {
        assertEventMatches(
          reloadedEvents[offset + i]!,
          turn.expectedEvents[i]! as Partial<Event>,
        );
      }
      offset += turn.expectedEvents.length;
    }

    await dbSessionService.close();
    return session;
  } finally {
    await server.stop();

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }
}
