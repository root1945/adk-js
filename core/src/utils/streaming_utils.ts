/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FinishReason,
  FunctionCall,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  Part,
  PartialArg,
} from '@google/genai';
import {FeatureName, isFeatureEnabled} from '../features/index.js';
import {createLlmResponse, LlmResponse} from '../models/llm_response.js';

export class StreamingResponseAggregator {
  private text: string = '';
  private thoughtText: string = '';
  private usageMetadata?: GenerateContentResponseUsageMetadata;
  private response?: GenerateContentResponse;

  // For progressive SSE streaming mode: accumulate parts in order
  private partsSequence: Part[] = [];
  private currentTextBuffer: string = '';
  private currentTextIsThought: boolean | undefined = undefined;
  private finishReason?: FinishReason;

  // For streaming function call arguments
  private currentFcName?: string;
  private currentFcArgs: Record<string, unknown> = {};
  private currentFcId?: string;
  private currentThoughtSignature?: string;

  /**
   * Flush current text buffer to parts sequence.
   *
   * This helper is used in progressive SSE mode to maintain part ordering.
   * It only merges consecutive text parts of the same type (thought or regular).
   */
  private flushTextBufferToSequence(): void {
    if (!this.currentTextBuffer) {
      return;
    }

    if (this.currentTextIsThought) {
      this.partsSequence.push({
        text: this.currentTextBuffer,
        thought: true,
      });
    } else {
      this.partsSequence.push({
        text: this.currentTextBuffer,
      });
    }

    this.currentTextBuffer = '';
    this.currentTextIsThought = undefined;
  }

  /**
   * Extract value from a partial argument.
   *
   * @param partialArg The partial argument object
   * @param jsonPath JSONPath for this argument
   * @returns Tuple of [value, hasValue] where hasValue indicates if a value exists
   */
  private getValueFromPartialArg(
    partialArg: PartialArg,
    jsonPath: string,
  ): {
    value: unknown;
    hasValue: boolean;
  } {
    let value: unknown = null;
    let hasValue = false;

    if (
      partialArg.stringValue !== undefined &&
      partialArg.stringValue !== null
    ) {
      // For streaming strings, append chunks to existing value
      const stringChunk = partialArg.stringValue;
      hasValue = true;

      // Get current value for this path (if any)
      const pathWithoutPrefix = jsonPath.startsWith('$.')
        ? jsonPath.substring(2)
        : jsonPath;
      const pathParts = pathWithoutPrefix.split('.');

      // Try to get existing value
      let existingValue: Record<string, unknown> | null = this.currentFcArgs;
      for (const part of pathParts) {
        if (
          existingValue &&
          typeof existingValue === 'object' &&
          part in existingValue
        ) {
          existingValue = existingValue[part] as Record<string, unknown>;
        } else {
          existingValue = null;
          break;
        }
      }

      // Append to existing string or set new value
      if (typeof existingValue === 'string') {
        value = existingValue + stringChunk;
      } else {
        value = stringChunk;
      }
    } else if (
      partialArg.numberValue !== undefined &&
      partialArg.numberValue !== null
    ) {
      value = partialArg.numberValue;
      hasValue = true;
    } else if (
      partialArg.boolValue !== undefined &&
      partialArg.boolValue !== null
    ) {
      value = partialArg.boolValue;
      hasValue = true;
    } else if (
      partialArg.nullValue !== undefined &&
      partialArg.nullValue !== null
    ) {
      value = null;
      hasValue = true;
    }

    return {value, hasValue};
  }

  /**
   * Set a value in _currentFcArgs using JSONPath notation.
   *
   * @param jsonPath JSONPath string like "$.location" or "$.location.latitude"
   * @param value The value to set
   */
  private setValueByJsonPath(jsonPath: string, value: unknown): void {
    // Remove leading "$." from jsonPath
    const path = jsonPath.startsWith('$.') ? jsonPath.substring(2) : jsonPath;

    // Split path into components
    const pathParts = path.split('.');

    // Navigate to the correct location and set the value
    let current = this.currentFcArgs;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    // Set the final value
    current[pathParts[pathParts.length - 1]] = value;
  }

  /**
   * Flush current function call to parts sequence.
   *
   * This creates a complete FunctionCall part from accumulated partial args.
   */
  private flushFunctionCallToSequence(): void {
    if (!this.currentFcName) {
      return;
    }

    // Create function call part with accumulated args
    const part: Part = {
      functionCall: {
        name: this.currentFcName,
        args: {...this.currentFcArgs},
      },
    };

    // Set the ID if provided (directly on the function_call object)
    if (this.currentFcId && part.functionCall) {
      part.functionCall.id = this.currentFcId;
    }

    // Set thought_signature if provided (on the Part, not FunctionCall)
    if (this.currentThoughtSignature) {
      part.thoughtSignature = this.currentThoughtSignature;
    }

    this.partsSequence.push(part);

    // Reset FC state
    this.currentFcName = undefined;
    this.currentFcArgs = {};
    this.currentFcId = undefined;
    this.currentThoughtSignature = undefined;
  }

  /**
   * Process a streaming function call with partialArgs.
   *
   * @param fc The function call object with partial_args
   */
  private processStreamingFunctionCall(fc: FunctionCall): void {
    // Save function name if present (first chunk)
    if (fc.name) {
      this.currentFcName = fc.name;
    }
    if (fc.id) {
      this.currentFcId = fc.id;
    }

    // Process each partial argument
    const partialArgs = fc.partialArgs || [];
    for (const partialArg of partialArgs) {
      const jsonPath = partialArg.jsonPath;
      if (!jsonPath) {
        continue;
      }

      // Extract value from partial arg
      const {value, hasValue} = this.getValueFromPartialArg(
        partialArg as PartialArg,
        jsonPath,
      );

      // Set the value using JSONPath (only if a value was provided)
      if (hasValue) {
        this.setValueByJsonPath(jsonPath, value);
      }
    }

    if (!fc.willContinue) {
      // Function call complete, flush it
      this.flushTextBufferToSequence();
      this.flushFunctionCallToSequence();
    }
  }

  /**
   * Process a function call part (streaming or non-streaming).
   *
   * @param part The part containing a function call
   */
  private processFunctionCallPart(part: Part): void {
    const fc = part.functionCall as FunctionCall;
    if (!fc) return;

    // Check if this is a streaming FC (has partialArgs)
    if ((fc.partialArgs && fc.partialArgs.length > 0) || fc.willContinue) {
      // Streaming function call arguments
      // Save thought_signature from the part (first chunk should have it)
      if (part.thoughtSignature && !this.currentThoughtSignature) {
        this.currentThoughtSignature = part.thoughtSignature;
      }
      this.processStreamingFunctionCall(fc);
    } else {
      // Non-streaming function call (standard format with args)
      // Skip empty function calls (used as streaming end markers)
      if (fc.name) {
        // Flush any buffered text first, then add the FC part
        this.flushTextBufferToSequence();
        this.partsSequence.push(part);
      }
    }
  }

  /**
   * Processes a single model response.
   *
   * @param response The response to process.
   *
   * Yields:
   *   The generated LlmResponse(s), for the partial response, and the aggregated
   *   response if needed.
   */
  async *processResponse(
    response: GenerateContentResponse,
  ): AsyncGenerator<LlmResponse, void, unknown> {
    this.response = response;
    const llmResponse = createLlmResponse(response);
    this.usageMetadata = llmResponse.usageMetadata;

    // ========== Progressive SSE Streaming (new feature) ==========
    // Save finish_reason for final aggregation
    if (llmResponse.finishReason) {
      this.finishReason = llmResponse.finishReason;
    }

    if (isFeatureEnabled(FeatureName.PROGRESSIVE_SSE_STREAMING)) {
      // Accumulate parts while preserving their order
      // Only merge consecutive text parts of the same type (thought or regular)
      if (llmResponse.content && llmResponse.content.parts?.length) {
        for (const part of llmResponse.content.parts) {
          if (part.text) {
            // Check if we need to flush the current buffer first
            // (when text type changes from thought to regular or vice versa)
            if (
              this.currentTextBuffer &&
              part.thought !== this.currentTextIsThought
            ) {
              this.flushTextBufferToSequence();
            }

            // Accumulate text to buffer
            if (!this.currentTextBuffer) {
              this.currentTextIsThought = part.thought;
            }
            this.currentTextBuffer += part.text;
          } else if (part.functionCall) {
            // Process function call (handles both streaming Args and
            // non-streaming Args)
            this.processFunctionCallPart(part);
          } else {
            // Other non-text parts (bytes, etc.)
            // Flush any buffered text first, then add the non-text part
            this.flushTextBufferToSequence();
            this.partsSequence.push(part);
          }
        }
      }

      // Mark ALL intermediate chunks as partial
      llmResponse.partial = true;
      yield llmResponse;
      return;
    }

    // ========== Non-Progressive SSE Streaming (old behavior) ==========
    if (
      llmResponse.content &&
      llmResponse.content.parts?.length &&
      llmResponse.content.parts[0].text
    ) {
      const part0 = llmResponse.content.parts[0];
      if (part0.thought) {
        this.thoughtText += part0.text;
      } else {
        this.text += part0.text;
      }
      llmResponse.partial = true;
    } else if (
      (this.thoughtText || this.text) &&
      (!llmResponse.content ||
        !llmResponse.content.parts ||
        // don't yield the merged text event when receiving audio data
        !llmResponse.content.parts[0].inlineData)
    ) {
      const parts: Part[] = [];
      if (this.thoughtText) {
        parts.push({text: this.thoughtText, thought: true});
      }
      if (this.text) {
        parts.push({text: this.text});
      }
      yield {
        content: {parts},
        usageMetadata: llmResponse.usageMetadata,
      } as LlmResponse;
      this.thoughtText = '';
      this.text = '';
    }
    yield llmResponse;
  }

  /**
   * Generate an aggregated response at the end, if needed.
   *
   * This should be called after all the model responses are processed.
   *
   * @returns The aggregated LlmResponse.
   */
  close(): LlmResponse | undefined {
    // ========== Progressive SSE Streaming (new feature) ==========
    if (isFeatureEnabled(FeatureName.PROGRESSIVE_SSE_STREAMING)) {
      // Always generate final aggregated response in progressive mode
      if (
        this.response &&
        this.response.candidates &&
        this.response.candidates.length > 0
      ) {
        // Flush any remaining buffers to complete the sequence
        this.flushTextBufferToSequence();
        this.flushFunctionCallToSequence();

        // Use the parts sequence which preserves original ordering
        const finalParts = this.partsSequence;

        if (finalParts.length > 0) {
          const candidate = this.response.candidates[0];
          const finishReason = this.finishReason || candidate.finishReason;

          return {
            content: {parts: finalParts},
            errorCode:
              finishReason === FinishReason.STOP
                ? undefined
                : (finishReason as unknown as string), // Casting enum to string if needed, or keeping as enum
            errorMessage:
              finishReason === FinishReason.STOP
                ? undefined
                : candidate.finishMessage,
            usageMetadata: this.usageMetadata,
            finishReason: finishReason,
            partial: false,
          };
        }

        return undefined;
      }
    }

    // ========== Non-Progressive SSE Streaming (old behavior) ==========
    if (
      (this.text || this.thoughtText) &&
      this.response &&
      this.response.candidates
    ) {
      const parts: Part[] = [];
      if (this.thoughtText) {
        parts.push({text: this.thoughtText, thought: true});
      }
      if (this.text) {
        parts.push({text: this.text});
      }
      const candidate = this.response.candidates[0];
      return {
        content: {parts},
        errorCode:
          candidate.finishReason === FinishReason.STOP
            ? undefined
            : (candidate.finishReason as unknown as string),
        errorMessage:
          candidate.finishReason === FinishReason.STOP
            ? undefined
            : candidate.finishMessage,
        usageMetadata: this.usageMetadata,
      };
    }
    return undefined;
  }
}
