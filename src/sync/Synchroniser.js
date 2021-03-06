/**
 * mSupply Mobile
 * Sustainable Solutions (NZ) Ltd. 2016
 */

import autobind from 'react-autobind';

import { SyncQueue } from './SyncQueue';
import { SyncDatabase } from './SyncDatabase';
import { generateSyncJson } from './outgoingSyncUtils';
import { integrateRecord } from './incomingSyncUtils';
import { SETTINGS_KEYS } from '../settings';
import {
  incrementSyncProgress,
  setSyncProgress,
  setSyncProgressMessage,
  setSyncTotal,
  setSyncError,
  setSyncIsSyncing,
  setSyncCompletionTime,
} from './actions';

const {
  SYNC_IS_INITIALISED,
  SYNC_PRIOR_FAILED,
  SYNC_SITE_NAME,
  SYNC_SERVER_ID,
  SYNC_SITE_ID,
  SYNC_URL,
} = SETTINGS_KEYS;

const BATCH_SIZE = 20; // Number of records to sync at one time

/**
 * Provides core synchronization functionality, initilising the database with an
 * initial full sync, pushing, and pulling (any regular scheduling of synchronization
 * must be coordinated externally)
 * @param  {Realm}             database       The local database
 * @param  {SyncAuthenticator} authenticator  Provides authentication with the sync server
 * @param  {Settings}          settings       Access to locally stored settings
 */
export class Synchroniser {
  constructor(database, authenticator, settings, dispatch) {
    this.database = new SyncDatabase(database);
    this.authenticator = authenticator;
    this.settings = settings;
    this.syncQueue = new SyncQueue(this.database);
    this.dispatch = dispatch;
    autobind(this);
    if (this.isInitialised()) this.syncQueue.enable();
  }

  /**
   * Redux progress setting functions
   */
  setTotal(totalCount) { this.dispatch(setSyncTotal(totalCount)); }
  incrementProgress(increment) { this.dispatch(incrementSyncProgress(increment)); }
  setProgress(currentCount) { this.dispatch(setSyncProgress(currentCount)); }
  setProgressMessage(message) { this.dispatch(setSyncProgressMessage(message)); }
  setError(errorMessage) { this.dispatch(setSyncError(errorMessage)); }
  setIsSyncing(isSyncing) { this.dispatch(setSyncIsSyncing(isSyncing)); }
  setCompletionTime(time) { this.dispatch(setSyncCompletionTime(time)); }

  /**
   * Wipe the current database, check that the given url can be synced against
   * using the given name and password, and if so populate the database by pulling
   * from the remote server.
   * @param  {string} serverURL        The URL to be synced against
   * @param  {string} syncSiteName     The username to use in sync auth
   * @param  {string} syncSitePassword The password to use in sync auth
   * @return {Promise}                 Resolve if successfully authenticated and
   *                                   initialised, otherwise throw error
   */
  async initialise(serverURL, syncSiteName, syncSitePassword) {
    this.setIsSyncing(true);
    this.setProgressMessage('Initialising...');
    this.syncQueue.disable(); // Stop sync queue listening to database changes
    // Check if the serverURL passed in is the same as one we have already been using during
    // initialisation, in which case we are continuing a failed partial initialisation. If the
    // serverURL is different, it is either completely fresh, or the URL has been changed so we
    // should start afresh. Do the same for syncSiteName, so that it isn't possible to start syncing
    // data from a site different to what initialisation was previously started with.
    const oldSyncUrl = this.settings.get(SYNC_URL);
    const oldSyncSiteName = this.settings.get(SYNC_SITE_NAME);
    const isFresh =
      !oldSyncUrl || serverURL !== oldSyncUrl || !syncSiteName || syncSiteName !== oldSyncSiteName;

    if (isFresh) {
      this.database.write(() => {
        this.database.deleteAll();
      });
    }
    try {
      await this.authenticator.authenticate(serverURL, syncSiteName, syncSitePassword);
      const thisSiteId = this.settings.get(SYNC_SITE_ID);
      const serverId = this.settings.get(SYNC_SERVER_ID);
      if (isFresh) {
        // If a fresh initialisation, tell the server to prepare required sync records
        await fetch(
          `${serverURL}/sync/v3/initial_dump/?from_site=${thisSiteId}&to_site=${serverId}`,
          {
            headers: {
              Authorization: this.authenticator.getAuthHeader(),
            },
          }
        );
        // If the initial_dump has been successful, serverURL is valid, and should now have all sync
        // records queued and ready to send. Safe to store as this.serverURL
        this.serverURL = serverURL;
      }
      await this.pull();
    } catch (error) {
      // Did not authenticate, sync error, or no internet, pass error up
      this.setError(error.message);
      this.setIsSyncing(false);
      throw error;
    }
    this.settings.set(SYNC_IS_INITIALISED, 'true');
    this.syncQueue.enable(); // Begin the sync queue listening to database changes
    this.setIsSyncing(false);
  }

  /**
   * Return whether the synchroniser has been initialised.
   * @return {boolean} True if initial sync has been completed successfully
   */
  isInitialised() {
    const syncIsInitialised = this.settings.get(SYNC_IS_INITIALISED);
    return syncIsInitialised && syncIsInitialised === 'true';
  }

  /**
   * Return whether or not the last sync of the app failed
   * @return {boolean} 'true' if the last call of synchronise failed
   */
  lastSyncFailed() {
    const lastSyncFailed = this.settings.get(SYNC_PRIOR_FAILED);
    return lastSyncFailed && lastSyncFailed === 'true';
  }

  /**
   * Carry out a synchronization, first pushing any local changes, then pulling
   * down remote changes and integrating them into the local database.
   * @return {[type]} [description]
   */
  async synchronise() {
    try {
      if (!this.isInitialised()) throw new Error('Not yet initialised');
      this.setIsSyncing(true);

      // Keeps track between app close/open whether last sync was successful
      this.settings.set(SYNC_PRIOR_FAILED, 'true');

      // Using async/await here means that any errors thrown by push or pull will be caught by the
      // outer try/catch
      await this.push();
      await this.pull();

      // Store persistent sync details in settings
      this.settings.set(SYNC_PRIOR_FAILED, 'false');

      // Store sync completion progress in redux
      this.setIsSyncing(false);
      this.setCompletionTime(new Date().getTime());
    } catch (error) {
      this.setError(error.message);
      this.setIsSyncing(false);
    }
  }

  /**
   * Push batches of changes to the local database up to the remote server, until
   * all local changes have been synced.
   * @return {Promise} Resolves if successful, or passes up any error thrown
   */
  async push() {
    this.setProgressMessage('Pushing changes to the server');
    this.setProgress(0);
    let recordsToSync;
    let translatedRecords;
    this.setTotal(this.syncQueue.length);
    while (this.syncQueue.length > 0) {
      recordsToSync = this.syncQueue.next(BATCH_SIZE);
      translatedRecords = recordsToSync.map(record =>
        generateSyncJson(this.database, this.settings, record)
      );
      await this.pushRecords(translatedRecords);
      this.syncQueue.use(recordsToSync);
      this.incrementProgress(recordsToSync.length);
    }
  }

  /**
   * Pushes a collection of records to the remote sync server
   * @param  {array}   records The records to push
   * @return {Promise}         Resolves if successful, or passes up any error thrown
   */
  async pushRecords(records) {
    const serverURL = this.settings.get(SYNC_URL);
    const thisSiteId = this.settings.get(SYNC_SITE_ID);
    const serverId = this.settings.get(SYNC_SERVER_ID);
    const response = await fetch(
      `${serverURL}/sync/v3/queued_records/?from_site=${thisSiteId}&to_site=${serverId}`,
      {
        method: 'POST',
        headers: {
          Authorization: this.authenticator.getAuthHeader(),
        },
        body: JSON.stringify(records),
      }
    );
    let responseJson;
    try {
      responseJson = await response.json();
    } catch (error) {
      throw new Error('Unexpected response from sync server');
    }
    if (responseJson.error.length > 0) {
      throw new Error('Server rejected pushed records');
    }
  }

  /**
   * Pulls any changes to data on the sync server down to the local database
   * @return {Promise} Resolves if successful, or passes up any error thrown
   */
  async pull() {
    this.setProgressMessage('Pulling changes from the server');
    this.setProgress(0);
    this.setTotal(0);
    const serverURL = this.settings.get(SYNC_URL);
    const thisSiteId = this.settings.get(SYNC_SITE_ID);
    const serverId = this.settings.get(SYNC_SERVER_ID);
    await this.recursivePull(serverURL, thisSiteId, serverId, 0);
  }

  /**
   * Recursively checks how many records left to pull, pulls in a batch, and calls
   * itself
   * @param  {string} serverURL  The URL of the sync server
   * @param  {string} thisSiteId The sync ID of this sync site
   * @param  {string} serverId   The sync ID of the server
   * @return {Promise}          Resolves if successful, or passes up any error thrown
   */
  async recursivePull(serverURL, thisSiteId, serverId, currentTotal) {
    const authHeader = this.authenticator.getAuthHeader();
    const waitingRecordCount = await this.getWaitingRecordCount(
      serverURL,
      thisSiteId,
      serverId,
      authHeader
    );
    // Allow total to increase in case more records are added to the server sync queue during sync
    const newTotal = Math.max(waitingRecordCount, currentTotal);
    this.setTotal(newTotal);
    if (waitingRecordCount === 0) return; // Done recursing through records

    // Get a batch of records and integrate them
    const incomingRecords = await this.getIncomingRecords(
      serverURL,
      thisSiteId,
      serverId,
      authHeader,
      BATCH_SIZE
    );
    this.integrateRecords(incomingRecords);
    await this.acknowledgeRecords(serverURL, thisSiteId, serverId, authHeader, incomingRecords);
    this.incrementProgress(incomingRecords.length);

    // Recurse to get the next batch of records from the server
    await this.recursivePull(serverURL, thisSiteId, serverId, newTotal);
  }

  /**
   * Returns the number of records left to pull
   * @param  {string} serverURL  URL of the sync server
   * @param  {string} thisSiteId Sync ID of this sync site
   * @param  {string} serverId   Sync ID of the server
   * @return {Promise}           Resolves with the record count, or passes up any error thrown
   */
  async getWaitingRecordCount(serverURL, thisSiteId, serverId, authHeader) {
    const response = await fetch(
      `${serverURL}/sync/v3/queued_records/count?from_site=${thisSiteId}&to_site=${serverId}`,
      {
        headers: {
          Authorization: authHeader,
        },
      }
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error('Connection failure while attempting to sync.');
    }
    const responseJson = await response.json();
    if (responseJson.error && responseJson.error.length > 0) {
      throw new Error(responseJson.error);
    }
    if (typeof responseJson.NumRecords !== 'number') {
      throw new Error('Unexpected response from server');
    }
    return responseJson.NumRecords;
  }

  /**
   * Returns the next batch of incoming sync records
   * @param  {string}  serverURL  The URL of the sync server
   * @param  {string}  thisSiteId The sync ID of this sync site
   * @param  {string}  serverId   The sync ID of the server
   * @param  {integer} numRecords The number of records to fetch
   * @return {Promise}            Resolves with the records, or passes up any error thrown
   */
  async getIncomingRecords(serverURL, thisSiteId, serverId, authHeader, numRecords) {
    const response = await fetch(
      `${serverURL}/sync/v3/queued_records` +
        `?from_site=${thisSiteId}&to_site=${serverId}&limit=${numRecords}`,
      {
        headers: {
          Authorization: authHeader,
        },
      }
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error('Connection failure while pulling sync records.');
    }
    const responseJson = await response.json();
    if (responseJson.error && responseJson.error.length > 0) {
      throw new Error(responseJson.error);
    }
    return responseJson;
  }

  /**
   * Parse the batch of incoming records, and integrate them into the local database
   * @param  {Realm}  database The local database
   * @param  {object} records  The json object the server sent to represent records
   * @return {none}
   */
  integrateRecords(syncJson) {
    this.database.write(() => {
      syncJson.forEach(syncRecord => {
        integrateRecord(this.database, this.settings, syncRecord);
      });
    });
  }

  /**
   * Sends the sync server a message to indicate the sync records have been consumed
   * @param  {string}  serverURL  Base URL of the sync server
   * @param  {string}  thisSiteId Sync id of this mobile site
   * @param  {string}  serverId   Sync id of the primary server
   * @param  {string}  authHeader Base64 encoded Basic auth header
   * @param  {array}   records    Sync records that have been integrated
   * @return {none}
   */
  async acknowledgeRecords(serverURL, thisSiteId, serverId, authHeader, records) {
    const syncIds = records.map(record => record.SyncID);
    const requestBody = {
      SyncRecordIDs: syncIds,
    };
    await fetch(
      `${serverURL}/sync/v3/acknowledged_records?from_site=${thisSiteId}&to_site=${serverId}`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
        },
        body: JSON.stringify(requestBody),
      }
    );
  }
}
