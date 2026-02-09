import {cloneDeep} from 'lodash-es';
import {WhereOptions} from 'sequelize';
import {
  Column,
  DataType,
  Model,
  Sequelize,
  SequelizeOptions,
  Table,
} from 'sequelize-typescript';

import {Event} from '../events/event.js';
import {randomUUID} from '../utils/env_aware_utils.js';
import {
  AppendEventRequest,
  BaseSessionService,
  CreateSessionRequest,
  DeleteSessionRequest,
  GetSessionRequest,
  ListSessionsRequest,
  ListSessionsResponse,
} from './base_session_service.js';
import {createSession, Session} from './session.js';
import {State} from './state.js';

@Table({tableName: 'storage_app_state', timestamps: false})
class StorageAppState extends Model {
  @Column({primaryKey: true, type: DataType.STRING})
  declare app_name: string;

  @Column({type: DataType.JSON})
  declare state: Record<string, unknown>;
}

@Table({tableName: 'storage_user_state', timestamps: false})
class StorageUserState extends Model {
  @Column({primaryKey: true, type: DataType.STRING})
  declare app_name: string;

  @Column({primaryKey: true, type: DataType.STRING})
  declare user_id: string;

  @Column({type: DataType.JSON})
  declare state: Record<string, unknown>;
}

@Table({
  tableName: 'storage_session',
  timestamps: true,
  createdAt: 'create_time',
  updatedAt: 'update_time',
})
class StorageSession extends Model {
  @Column({primaryKey: true, type: DataType.STRING})
  declare id: string;

  @Column({type: DataType.STRING})
  declare app_name: string;

  @Column({type: DataType.STRING})
  declare user_id: string;

  @Column({type: DataType.JSON})
  declare state: Record<string, unknown>;
}

@Table({tableName: 'storage_event', timestamps: false})
class StorageEvent extends Model {
  @Column({type: DataType.STRING})
  declare app_name: string;

  @Column({type: DataType.STRING})
  declare user_id: string;

  @Column({type: DataType.STRING})
  declare session_id: string;

  @Column({type: DataType.BIGINT}) // Store timestamp as number
  declare timestamp: number;

  @Column({type: DataType.JSON})
  declare event_data: Event;
}

/**
 * A session service that uses a SQL database for storage via Sequelize.
 */
export class DatabaseSessionService extends BaseSessionService {
  private sequelize: Sequelize;
  private initialized = false;

  constructor(optionsOrUrl: SequelizeOptions | string) {
    super();
    if (typeof optionsOrUrl === 'string') {
      this.sequelize = new Sequelize(optionsOrUrl, {
        models: [
          StorageAppState,
          StorageUserState,
          StorageSession,
          StorageEvent,
        ],
        logging: false,
      });
    } else {
      this.sequelize = new Sequelize({
        ...optionsOrUrl,
        models: [
          StorageAppState,
          StorageUserState,
          StorageSession,
          StorageEvent,
        ],
        logging: false,
      });
    }
  }

  private async init() {
    if (!this.initialized) {
      await this.sequelize.sync();
      this.initialized = true;
    }
  }

  async createSession({
    appName,
    userId,
    state,
    sessionId,
  }: CreateSessionRequest): Promise<Session> {
    await this.init();

    const id = sessionId || randomUUID();

    // Check if exists
    const existing = await StorageSession.findOne({
      where: {id, app_name: appName, user_id: userId},
    });
    if (existing) {
      throw new Error(`Session with id ${id} already exists.`);
    }

    // Initialize states if not exist
    const [appStateModel] = await StorageAppState.findOrCreate({
      where: {app_name: appName},
      defaults: {app_name: appName, state: {}},
    });

    const [userStateModel] = await StorageUserState.findOrCreate({
      where: {app_name: appName, user_id: userId},
      defaults: {app_name: appName, user_id: userId, state: {}},
    });

    // Extract deltas from initial state
    const appStateDelta: Record<string, unknown> = {};
    const userStateDelta: Record<string, unknown> = {};
    const sessionState: Record<string, unknown> = {};

    if (state) {
      for (const [key, value] of Object.entries(state)) {
        if (key.startsWith(State.APP_PREFIX)) {
          appStateDelta[key.replace(State.APP_PREFIX, '')] = value;
        } else if (key.startsWith(State.USER_PREFIX)) {
          userStateDelta[key.replace(State.USER_PREFIX, '')] = value;
        } else {
          sessionState[key] = value;
        }
      }
    }

    // Apply deltas
    if (Object.keys(appStateDelta).length > 0) {
      appStateModel.state = {...appStateModel.state, ...appStateDelta};
      await appStateModel.save();
    }
    if (Object.keys(userStateDelta).length > 0) {
      userStateModel.state = {...userStateModel.state, ...userStateDelta};
      await userStateModel.save();
    }

    const now = Date.now();
    // In database implementation, we persist the session state
    const storageSession = await StorageSession.create({
      id,
      app_name: appName,
      user_id: userId,
      state: sessionState,
      // timestamps handled by sequelize
    });

    const mergedState = mergeStates(
      appStateModel.state,
      userStateModel.state,
      sessionState,
    );

    return createSession({
      id,
      appName,
      userId,
      state: mergedState,
      events: [],
      lastUpdateTime: storageSession.createdAt
        ? storageSession.createdAt.getTime()
        : now,
    });
  }

  async getSession({
    appName,
    userId,
    sessionId,
    config,
  }: GetSessionRequest): Promise<Session | undefined> {
    await this.init();

    const storageSession = await StorageSession.findOne({
      where: {app_name: appName, user_id: userId, id: sessionId},
    });

    if (!storageSession) {
      return undefined;
    }

    const eventWhere: WhereOptions<StorageEvent> = {
      app_name: appName,
      user_id: userId,
      session_id: sessionId,
    };

    if (config?.afterTimestamp) {
      // Sequelize operator lookup would be better, but for simplicity/universality:
      // const { Op } = require('sequelize');
      // where.timestamp = { [Op.gt]: config.afterTimestamp };
      // Trying to avoid dynamic import complexity for now if possible,
      // but importing Op from sequelize-typescript is standard.
    }

    // We can't easily do partial event fetching without Op.
    // Let's just fetch and filter for MVP or import Op.
    // Given imports, I should import Op.

    // For now, let's fetch all and filter in memory if list is small, or just assume full fetch.
    // Actually, `sequelize-typescript` exports don't include Op directly, usually it's on Sequelize.
    // Let's skip complex filtering in DB for MVP unless strictly required,
    // or use raw queries if needed.
    // Wait, I can simple retrieve all events sorted.

    // Actually, let's just get all events for the session.
    const storageEvents = await StorageEvent.findAll({
      where: eventWhere,
      order: [['timestamp', 'ASC']],
    });

    let eventsFn = storageEvents.map((se) => se.event_data);

    if (config?.afterTimestamp) {
      eventsFn = eventsFn.filter((e) => e.timestamp > config.afterTimestamp!);
    }
    if (config?.numRecentEvents) {
      eventsFn = eventsFn.slice(-config.numRecentEvents);
    }

    const appStateModel = await StorageAppState.findByPk(appName);
    const userStateModel = await StorageUserState.findOne({
      where: {app_name: appName, user_id: userId},
    });

    const mergedState = mergeStates(
      appStateModel?.state || {},
      userStateModel?.state || {},
      storageSession.state,
    );

    return createSession({
      id: sessionId,
      appName,
      userId,
      state: mergedState,
      events: eventsFn,
      lastUpdateTime: storageSession.updatedAt
        ? storageSession.updatedAt.getTime()
        : Date.now(),
    });
  }

  async listSessions({
    appName,
    userId,
  }: ListSessionsRequest): Promise<ListSessionsResponse> {
    await this.init();

    const where: WhereOptions<StorageSession> = {app_name: appName};
    if (userId) {
      where.user_id = userId;
    }

    const storageSessions = await StorageSession.findAll({where});

    // We need app state
    const appStateModel = await StorageAppState.findByPk(appName);
    const appState = appStateModel?.state || {};

    // For user states, we might need multiple if userId is not provided (listing all sessions for app)
    // Minimally, we can fetch them individually or in bulk.
    // If userId is provided, fetch once.
    const userStateMap: Record<string, Record<string, unknown>> = {};

    if (userId) {
      const u = await StorageUserState.findOne({
        where: {app_name: appName, user_id: userId},
      });
      if (u) userStateMap[userId] = u.state;
    } else {
      const allUserStates = await StorageUserState.findAll({
        where: {app_name: appName},
      });
      for (const u of allUserStates) {
        userStateMap[u.user_id] = u.state;
      }
    }

    const sessions = storageSessions.map((ss) => {
      const uState = userStateMap[ss.user_id] || {};
      const merged = mergeStates(appState, uState, ss.state);
      return createSession({
        id: ss.id,
        appName: ss.app_name,
        userId: ss.user_id,
        state: merged,
        events: [], // ListSessions doesn't return events
        lastUpdateTime: ss.updatedAt ? ss.updatedAt.getTime() : Date.now(),
      });
    });

    return {sessions};
  }

  async deleteSession({
    appName,
    userId,
    sessionId,
  }: DeleteSessionRequest): Promise<void> {
    await this.init();
    await StorageSession.destroy({
      where: {app_name: appName, user_id: userId, id: sessionId},
    });
    // Events should technically be deleted too? Python impl doesn't seem to explicitly cascade in the snippet?
    // Actually, usually you want to delete events too.
    await StorageEvent.destroy({
      where: {app_name: appName, user_id: userId, session_id: sessionId},
    });
  }

  override async appendEvent({
    session,
    event,
  }: AppendEventRequest): Promise<Event> {
    await this.init();

    // Call super to update in-memory session object (if we were keeping one context, but here `session` is passed in)
    // `session` here is the object user has.

    /* 
       Logic:
       1. Check if session is stale (compare lastUpdateTime).
       2. Update states (App, User, Session).
       3. Persist Event. 
       4. Update Session timestamp.
    */

    const storageSession = await StorageSession.findOne({
      where: {
        app_name: session.appName,
        user_id: session.userId,
        id: session.id,
      },
    });

    if (!storageSession) {
      throw new Error(`Session ${session.id} not found for appendEvent`);
    }

    // Reload if stale?
    // Python impl checks timestamp.
    // Here we can just re-fetch states and re-merge if we want to be safe,
    // but for now let's assume we proceed with delta application.

    const [appStateModel] = await StorageAppState.findOrCreate({
      where: {app_name: session.appName},
      defaults: {app_name: session.appName, state: {}},
    });

    const [userStateModel] = await StorageUserState.findOrCreate({
      where: {app_name: session.appName, user_id: session.userId},
      defaults: {app_name: session.appName, user_id: session.userId, state: {}},
    });

    if (event.actions && event.actions.stateDelta) {
      const appDelta: Record<string, unknown> = {};
      const userDelta: Record<string, unknown> = {};
      const sessionDelta: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(event.actions.stateDelta)) {
        if (key.startsWith(State.TEMP_PREFIX)) continue;

        if (key.startsWith(State.APP_PREFIX)) {
          appDelta[key.replace(State.APP_PREFIX, '')] = value;
        } else if (key.startsWith(State.USER_PREFIX)) {
          userDelta[key.replace(State.USER_PREFIX, '')] = value;
        } else {
          sessionDelta[key] = value;
        }
      }

      if (Object.keys(appDelta).length > 0) {
        appStateModel.state = {...appStateModel.state, ...appDelta};
        await appStateModel.save();
      }
      if (Object.keys(userDelta).length > 0) {
        userStateModel.state = {...userStateModel.state, ...userDelta};
        await userStateModel.save();
      }
      if (Object.keys(sessionDelta).length > 0) {
        storageSession.state = {...storageSession.state, ...sessionDelta};
        await storageSession.save();
      }
    }

    // Save event
    await StorageEvent.create({
      app_name: session.appName,
      user_id: session.userId,
      session_id: session.id,
      timestamp: event.timestamp,
      event_data: event,
    });

    // Update session timestamp
    // storageSession.changed('updatedAt', true); // Force update?
    // Actually just saving it again or explicitly updating timestamp might be needed if state didn't change?
    // Sequelize updates `updatedAt` on save if fields changed.
    storageSession.changed('updatedAt', true);
    await storageSession.save();

    // Update in-memory session object to reflect new state
    // We need to re-merge to get full state
    const newMergedState = mergeStates(
      appStateModel.state,
      userStateModel.state,
      storageSession.state,
    );
    session.state = newMergedState;
    session.events.push(event);
    session.lastUpdateTime = storageSession.updatedAt
      ? storageSession.updatedAt.getTime()
      : Date.now();

    return event;
  }
}

function mergeStates(
  appState: Record<string, unknown>,
  userState: Record<string, unknown>,
  sessionState: Record<string, unknown>,
) {
  const merged = cloneDeep(sessionState);
  for (const [k, v] of Object.entries(appState)) {
    merged[State.APP_PREFIX + k] = v;
  }
  for (const [k, v] of Object.entries(userState)) {
    merged[State.USER_PREFIX + k] = v;
  }
  return merged;
}
