import {BaseSessionService} from './base_session_service.js';
import {
  DatabaseSessionService,
  isDatabaseConnectionString,
} from './database_session_service.js';
import {
  InMemorySessionService,
  isInMemoryConnectionString,
} from './in_memory_session_service.js';

export function getSessionServiceFromUri(uri?: string): BaseSessionService {
  if (!uri && process.env.DATABASE_URL) {
    console.log(
      'Using DATABASE_URL from the environment to initialize SessionService',
      process.env.DATABASE_URL,
    );
    uri = process.env.DATABASE_URL;
  }

  if (isInMemoryConnectionString(uri)) {
    return new InMemorySessionService();
  }

  if (isDatabaseConnectionString(uri)) {
    return new DatabaseSessionService(uri!);
  }

  throw new Error(`Unsupported session service URI: ${uri}`);
}
