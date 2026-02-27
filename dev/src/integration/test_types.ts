/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {LlmRequest, LlmResponse, Session} from '@google/adk';
import {FunctionCall} from '@google/genai';

export interface StringPart {
  text?: string;
}

export interface FunctionResponse {
  // The function response can be any kind of object
  response: Map<string, unknown>;
  id: string;
  name: string;
}

export interface FunctionResponsePart {
  function_response: FunctionResponse;
}

export type ContentPart = StringPart | FunctionResponsePart;

export interface Content {
  parts: ContentPart[];
}

// The User message to replay. Either text or content will be filled in
export interface UserMessage {
  //The user message in text.
  text?: string;
  // The user message in types.Content.
  content?: Content;
  // The state changes when running this user message
  stateDelta?: Record<string, unknown>;
}

export interface TestSpec {
  // Human-readable description of what this test validates.
  description: string;
  // Name of the ADK agent to test against.
  agent: string;
  // The initial state key-value pairs in the creation_session request.
  // State could be string, numbers, objects, anything.
  initialState?: Record<string, unknown>;
  // Sequence of user messages to send to the agent during test execution.
  userMessages?: UserMessage[];
}

export interface LlmRecording {
  llmRequest?: LlmRequest;
  llmResponse?: LlmResponse;
}

export interface ToolRecording {
  toolCall?: FunctionCall;
  toolResponse?: FunctionResponse;
}

export interface Recording {
  userMessageIndex: number;
  agentName: string;

  // only one of these will be filled in
  llmRecording?: LlmRecording;
  toolRecording?: ToolRecording;
}

export interface Recordings {
  recordings: Recording[];
}

export interface TestInfo {
  name: string;
  spec: TestSpec;
  session: Session;
  recordings: Recordings;
}
