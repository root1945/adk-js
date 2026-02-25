/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Storage} from '@google-cloud/storage';
import {
  AbstractBucketArtifactService,
  StorageBucket,
} from './bucket_artifact_service.js';

/**
 * Artifact service that uses Google Cloud Storage.
 */
export class GcsArtifactService extends AbstractBucketArtifactService {
  constructor(bucket: string) {
    super(new Storage().bucket(bucket) as unknown as StorageBucket);
  }
}
