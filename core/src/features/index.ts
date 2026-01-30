/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum FeatureName {
  PROGRESSIVE_SSE_STREAMING = 'PROGRESSIVE_SSE_STREAMING',
}

export function isFeatureEnabled(featureName: FeatureName): boolean {
  switch (featureName) {
    case FeatureName.PROGRESSIVE_SSE_STREAMING:
      return true;
    default:
      return false;
  }
}
