/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {RequestContext} from '@a2a-js/sdk/server';
import {Content} from '@google/genai';
import {Event} from '../events/event.js';
import {Session} from '../sessions/session.js';

export interface ExecutorContext {
  userId: string;
  sessionId: string;
  agentName: string;
  readonlyState: Record<string, unknown>;
  events: Event[];
  userContent: Content;
  requestContext: RequestContext;
}

export function createExecutorContext({
  userId,
  session,
  agentName,
  userContent,
  requestContext,
}: {
  userId: string;
  session?: Session;
  agentName: string;
  userContent: Content;
  requestContext: RequestContext;
}): ExecutorContext {
  return {
    userId,
    sessionId: session?.id || requestContext.contextId,
    agentName,
    readonlyState: session?.state || {},
    events: session?.events || [],
    userContent,
    requestContext,
  };
}
