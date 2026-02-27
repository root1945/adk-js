/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseAgent,
  BaseLlm,
  BaseLlmConnection,
  Event,
  InMemorySessionService,
  isLlmAgent,
  LlmRequest,
  LlmResponse,
  Runner,
  Session,
} from '@google/adk';
import {
  Blob,
  CodeExecutionResult,
  Content,
  ExecutableCode,
  FileData,
  FinishReason,
  GenerateContentResponseUsageMetadata,
  GroundingMetadata,
  PartMediaResolution,
  VideoMetadata,
} from '@google/genai';
import * as assert from 'node:assert';
import {AgentRegistry} from './agent_registry.js';
import {Recording, TestInfo, UserMessage} from './test_types.js';

const SKIPPED_TESTS = [
  {name: 'tool/example_tool_001', reason: 'ExampleTool is not implemented yet'},
  {name: 'workflow/loop_001', reason: 'ExitLoopTool is not implemented yet'},
];

class ReplayModel extends BaseLlm {
  constructor(
    private agentName: string,
    private recordings: Recording[],
    private context: {userMessageIndex: number},
  ) {
    super({model: 'replay-model'});
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  connect(llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error('Method not implemented.');
  }

  async *generateContentAsync(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    request: LlmRequest,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    stream?: boolean,
  ): AsyncGenerator<LlmResponse, void, void> {
    const index = this.recordings.findIndex(
      (r) =>
        r.userMessageIndex === this.context.userMessageIndex &&
        r.agentName === this.agentName &&
        r.llmRecording?.llmResponse &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        !(r as any)._consumed,
    );

    if (index === -1) {
      throw new Error(
        `No recording found for agent ${this.agentName} at turn ${this.context.userMessageIndex}`,
      );
    }

    const rec = this.recordings[index];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rec as any)._consumed = true;

    yield rec.llmRecording!.llmResponse!;
  }
}

export class TestRunner {
  constructor(private agentRegistry: AgentRegistry) {}

  async run(testInfo: TestInfo, force: boolean): Promise<boolean> {
    // skip tests for unimplemented features
    if (!force) {
      for (const skip of SKIPPED_TESTS) {
        if (skip.name == testInfo.name) {
          console.log('Skipping test', testInfo.name, 'because:', skip.reason);
          return true;
        }
      }
    }

    const agentName = testInfo.spec.agent;
    // Use the "short name" in the specs. This could possibly break
    // if there is more than one agent with the same name. Full names
    // are qualified by the file path.
    const agent = this.agentRegistry.getRootAgentByShortName(agentName);
    if (!agent) {
      throw new Error(`Agent ${agentName} not found in registry`);
    }

    // Clone recordings to track consumption without mutating the original test info
    const recordings = JSON.parse(
      JSON.stringify(testInfo.recordings.recordings),
    );
    const context = {userMessageIndex: 0};

    this.injectReplayModel(agent, recordings, context);

    const sessionService = new InMemorySessionService();
    const runner = new Runner({
      agent,
      sessionService,
      appName: 'test-runner',
    });

    const userId = 'test-user';
    const sessionId = 'test-session';

    // Create the session explicitly
    await sessionService.createSession({
      appName: 'test-runner',
      userId,
      sessionId,
    });

    const userMessages = testInfo.spec.userMessages || [];

    for (let i = 0; i < userMessages.length; i++) {
      context.userMessageIndex = i;
      const userMsg = userMessages[i];
      const content = this.userMessageToContent(userMsg);

      const iterator = runner.runAsync({
        userId,
        sessionId,
        newMessage: content,
        stateDelta: i === 0 ? testInfo.spec.initialState : undefined,
      });

      for await (const _ of iterator) {
        // Consume events
      }
    }

    const session = await sessionService.getSession({
      appName: 'test-runner',
      userId,
      sessionId,
    });

    if (!session) {
      throw new Error('Session not found after execution');
    }

    this.validateSession(session, testInfo.session);

    return false;
  }

  private injectReplayModel(
    agent: BaseAgent,
    recordings: Recording[],
    context: {userMessageIndex: number},
  ) {
    if (isLlmAgent(agent)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (agent as any).model = new ReplayModel(agent.name, recordings, context);
    }

    // Traverse subagents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subAgents = (agent as any).subAgents as BaseAgent[];
    if (subAgents && Array.isArray(subAgents)) {
      for (const sub of subAgents) {
        this.injectReplayModel(sub, recordings, context);
      }
    }
  }

  private userMessageToContent(msg: UserMessage): Content {
    if (msg.content) {
      const content = msg.content as Content;
      content.role = 'user';
      return content;
    }
    if (msg.text) {
      return {role: 'user', parts: [{text: msg.text}]};
    }
    return {role: 'user', parts: []};
  }

  private validateSession(actual: Session, expected: Session) {
    const actualEvents = actual.events.map(this.normalizeEvent);
    const expectedEvents = expected.events.map(this.normalizeEvent);

    assert.deepStrictEqual(actualEvents, expectedEvents);
  }

  private normalizeEvent(event: Event): FilteredEvent {
    const filteredEvent = event as FilteredEvent;
    filterEventFields(filteredEvent);
    removeEmptyAndUndefinedFields(
      filteredEvent as unknown as Record<string, unknown>,
    );
    return filteredEvent;
  }
}

function removeEmptyAndUndefinedFields(obj: Record<string, unknown>) {
  for (const key in obj) {
    if (Object.hasOwn(obj, key)) {
      if (obj[key] === undefined || obj[key] === null) {
        delete obj[key];
      } else if (Array.isArray(obj[key])) {
        for (let i = 0; i < obj[key].length; i++) {
          removeEmptyAndUndefinedFields(obj[key][i] as Record<string, unknown>);
        }

        // Remove fields that are just an empty array
        if (obj[key].length === 0) {
          delete obj[key];
          continue;
        }
      } else if (typeof obj[key] === 'object') {
        removeEmptyAndUndefinedFields(obj[key] as Record<string, unknown>);

        // Remove fields that are just an empty object
        if (Object.keys(obj[key] as Record<string, unknown>).length === 0) {
          delete obj[key];
          continue;
        }
      }
    }
  }
}

// an ADK EventActions missing some filtered fields.
// Excluded is:
// - requestedAuthConfigs
// - requestedToolConfirmations
interface FilteredEventActions {
  skipSummarization?: boolean;
  stateDelta?: {
    [key: string]: unknown;
  };
  artifactDelta: {
    [key: string]: number;
  };
  transferToAgent?: string;
  escalate?: boolean;
}

function filterEventActionsStateDelta(actions?: FilteredEventActions) {
  if (!actions?.stateDelta) {
    return;
  }

  delete actions.stateDelta['_adk_recordings_config'];
  delete actions.stateDelta['_adk_replay_config'];
}

// A filtered GenAI Part missing some filtered fields
// Excluded is:
// - thought_signature
// - function_call
// - function_response
//
// Copying from the original type: Only one of these is expected to be set.
// More than one is invalid and an error.
interface FilteredPart {
  mediaResolution?: PartMediaResolution;
  codeExecutionResult?: CodeExecutionResult;
  executableCode?: ExecutableCode;
  fileData?: FileData;
  inlineData?: Blob;
  text?: string;
  thought?: boolean;
  videoMetadata?: VideoMetadata;
}

function filterPartFields(part: FilteredPart) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  delete (part as any).thoughtSignature;
  delete (part as any).functionCall;
  delete (part as any).functionResponse;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// A filtered GenAI Content.
// Not missing any fields, just holds FilteredPart instead of Part.
interface FilteredContent {
  parts?: FilteredPart[];
  role?: string;
}

// An ADK Event missing some filtered fields and holds a FilteredContent instead of a Content
// Excluded is:
// - id
// - timestamp
// - invocationId
// - longRunningToolIds
interface FilteredEvent {
  // From ADK Event
  author?: string;
  branch?: string;
  actions: FilteredEventActions;

  // From ADK LlmResponse, inherited by Event
  content?: FilteredContent;
  groundingMetadata?: GroundingMetadata;
  partial?: boolean;
  turnComplete?: boolean;
  errorCode?: string;
  errorMessage?: string;
  interrupted?: boolean;
  customMetadata?: {
    [key: string]: unknown;
  };
  usageMetadata?: GenerateContentResponseUsageMetadata;
  finishReason?: FinishReason;
}

function filterEventFields(event: FilteredEvent) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  delete (event as any).id;
  delete (event as any).timestamp;
  delete (event as any).invocationId;
  delete (event as any).longRunningToolIds;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  filterEventActionsStateDelta(event.actions);

  if (event.content) {
    event.content.parts?.forEach(filterPartFields);
  }
}
