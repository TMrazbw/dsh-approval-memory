/**
 * DAM — authenticated Host↔Client data bridge.
 *
 * The Web client uses ordinary same-origin `fetch` against these
 * `ctx.connection.fetch` routes. They inherit the Web API authentication and
 * avoid a custom Remote namespace/codegen step.
 */

export const SNAPSHOT_ROUTE = '/api/approval-memory.snapshot';
export const MUTATE_ROUTE = '/api/approval-memory.mutate';
export const SNAPSHOT_SCHEMA = 'dsh-approval-memory-snapshot/1';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function failure(message, status = 500, code = 'bridge-error') {
  return jsonResponse({ ok: false, code, message }, status);
}

/**
 * Build one detached snapshot for the panel.
 * @param {{store: object, dataRoot?: string, now?: number}} input - data sources.
 * @returns {Promise<object>} snapshot JSON.
 */
export async function buildSnapshot(input = {}) {
  const store = input.store;
  if (!store) throw new TypeError('buildSnapshot requires a store');
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const snapshot = store.snapshot();
  return {
    schema: SNAPSHOT_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    dataRoot: typeof input.dataRoot === 'string' ? input.dataRoot : store.root ?? null,
    ...snapshot,
    limits: {
      events: store.maxEvents ?? null,
      snapshotEvents: 100,
    },
  };
}

/**
 * Build the GET snapshot route.
 * @param {{store: object, dataRoot?: string}} options - data sources.
 * @returns {object} ConnectionFetchRoute.
 */
export function createSnapshotRoute(options = {}) {
  const store = options.store;
  if (!store) throw new TypeError('createSnapshotRoute requires a store');
  return {
    path: SNAPSHOT_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request?.method !== 'GET') {
        return jsonResponse({ ok: false, code: 'method-not-allowed' }, 405);
      }
      try {
        const ready = await store.init();
        if (ready?.ok !== true) {
          return failure(`store unavailable: ${ready?.code ?? 'unknown'}`, 503, 'store-error');
        }
        return jsonResponse(await buildSnapshot({ store, dataRoot: options.dataRoot }));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error), 500);
      }
    },
  };
}

async function readJson(request) {
  try {
    const value = await request.json();
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Build the POST mutation route.
 * Accepted actions: `setRule` (classKey + enabled), `closeAll`.
 * @param {{store: object}} options - data source.
 * @returns {object} ConnectionFetchRoute.
 */
export function createMutateRoute(options = {}) {
  const store = options.store;
  if (!store) throw new TypeError('createMutateRoute requires a store');
  return {
    path: MUTATE_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request?.method !== 'POST') {
        return jsonResponse({ ok: false, code: 'method-not-allowed' }, 405);
      }
      const contentType = request.headers?.get?.('content-type') ?? '';
      if (!contentType.toLowerCase().startsWith('application/json')) {
        return jsonResponse({ ok: false, code: 'unsupported-media-type' }, 415);
      }
      const body = await readJson(request);
      if (body === null) {
        return jsonResponse({ ok: false, code: 'invalid-body' }, 400);
      }
      try {
        if (body.action === 'setRule') {
          if (typeof body.classKey !== 'string' || body.classKey.length === 0) {
            return jsonResponse({ ok: false, code: 'invalid-class' }, 400);
          }
          if (typeof body.enabled !== 'boolean') {
            return jsonResponse({ ok: false, code: 'invalid-enabled' }, 400);
          }
          const result = await store.setRule(body.classKey, body.enabled, {
            source: 'ui',
            time: Number.isFinite(body.time) ? body.time : Date.now(),
          });
          if (result?.ok === true) return jsonResponse(result, 200);
          if (result?.code === 'denied-by-policy') return jsonResponse(result, 200);
          return jsonResponse(result ?? { ok: false, code: 'rule-failed' }, 500);
        }
        if (body.action === 'closeAll') {
          const result = await store.disableAll({
            source: 'ui',
            time: Number.isFinite(body.time) ? body.time : Date.now(),
          });
          return jsonResponse(result ?? { ok: false, code: 'close-all-failed' }, result?.ok === true ? 200 : 500);
        }
        return jsonResponse({ ok: false, code: 'unknown-action' }, 400);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error), 500);
      }
    },
  };
}

/**
 * Build both routes in registration order.
 * @param {{store: object, dataRoot?: string}} options - data sources.
 * @returns {object[]} snapshot then mutation route.
 */
export function createBridgeRoutes(options = {}) {
  return [createSnapshotRoute(options), createMutateRoute(options)];
}
