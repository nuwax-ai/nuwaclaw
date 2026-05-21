/**
 * Umi compatibility layer for nuwax → agent-workbench migration.
 *
 * All code ported from `workspace/nuwax` that uses Umi hooks must import
 * from this file instead of `umi` / `@umijs/max`. This is the ONLY
 * find-and-replace target when syncing from nuwax: change
 *   `from 'umi'` / `from '@umijs/max'`
 * to
 *   `from '../../compat/umi'`
 * (adjust the relative path as needed).
 *
 * agent-workbench is a plain React 18 module embedded in the Electron
 * renderer (or the existing nuwax PC Web shell). It does NOT bring up
 * an Umi runtime, so Umi-specific globals (`useModel`, `history`,
 * `useLocation`, `useParams`, `useRequest`) need replacements.
 *
 * Migration policy:
 *   - useParams / useLocation: derived from `NuwaxOpenAppProps` (the
 *     embedding host passes agentId / conversationId / pathname). Until
 *     the host wiring lands, stubs return empty values.
 *   - history: minimal `push` / `replace` shim; host can override via
 *     `setHistoryDriver()`. Default driver is a no-op + console.warn.
 *   - useRequest: thin wrapper around fetch-style functions, modelled
 *     after ahooks/Umi `useRequest` but only implements the subset the
 *     mirrored nuwax code actually touches (`run`, `runAsync`, `data`,
 *     `loading`, `manual`, `onSuccess`, `onError`, basic params).
 *   - useModel: stub that throws — agent-workbench replaces all Umi
 *     `useModel` calls with explicit props / context providers during
 *     Phase B (NuwaxOpenApp split). Importing `useModel` from this
 *     file is a sync-marker so reviewers notice unported call sites.
 *
 * @see NUWAX_SYNC.md
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  useParams                                                                 */
/* -------------------------------------------------------------------------- */

export interface UmiParams {
  id?: string;
  agentId?: string;
  [key: string]: string | undefined;
}

let paramsProvider: () => UmiParams = () => ({});

/**
 * Host registers how to resolve route params. agent-workbench's
 * NuwaxOpenApp typically calls this once at mount time with the props
 * it received from the embedding shell.
 */
export function setParamsProvider(provider: () => UmiParams): void {
  paramsProvider = provider;
}

export function useParams<T extends UmiParams = UmiParams>(): T {
  return paramsProvider() as T;
}

/* -------------------------------------------------------------------------- */
/*  useLocation                                                               */
/* -------------------------------------------------------------------------- */

export interface UmiLocation {
  pathname: string;
  search: string;
  hash: string;
  state?: unknown;
}

let locationProvider: () => UmiLocation = () => ({
  pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
  search: typeof window !== 'undefined' ? window.location.search : '',
  hash: typeof window !== 'undefined' ? window.location.hash : '',
});

export function setLocationProvider(provider: () => UmiLocation): void {
  locationProvider = provider;
}

export function useLocation(): UmiLocation {
  return locationProvider();
}

/* -------------------------------------------------------------------------- */
/*  history                                                                   */
/* -------------------------------------------------------------------------- */

export interface UmiHistory {
  push(path: string, state?: unknown): void;
  replace(path: string, state?: unknown): void;
  back(): void;
  go(delta: number): void;
}

const defaultHistory: UmiHistory = {
  push(path) {
    // eslint-disable-next-line no-console
    console.warn(
      '[compat/umi] history.push called without a driver; navigation no-op:',
      path,
    );
  },
  replace(path) {
    // eslint-disable-next-line no-console
    console.warn(
      '[compat/umi] history.replace called without a driver; navigation no-op:',
      path,
    );
  },
  back() {
    if (typeof window !== 'undefined') window.history.back();
  },
  go(delta) {
    if (typeof window !== 'undefined') window.history.go(delta);
  },
};

let historyDriver: UmiHistory = defaultHistory;

/**
 * Host registers a navigation driver. For Electron embedding this
 * typically forwards to React Router or to a host callback that
 * updates the surrounding shell.
 */
export function setHistoryDriver(driver: UmiHistory): void {
  historyDriver = driver;
}

/**
 * Proxy that always forwards to the currently registered driver, so
 * call sites that captured `history` at import time still pick up
 * later `setHistoryDriver()` calls.
 */
export const history: UmiHistory = {
  push: (path, state) => historyDriver.push(path, state),
  replace: (path, state) => historyDriver.replace(path, state),
  back: () => historyDriver.back(),
  go: (delta) => historyDriver.go(delta),
};

/* -------------------------------------------------------------------------- */
/*  useRequest                                                                */
/* -------------------------------------------------------------------------- */

export interface UseRequestOptions<TData, TParams extends unknown[]> {
  manual?: boolean;
  defaultParams?: TParams;
  onSuccess?: (data: TData, params: TParams) => void;
  onError?: (error: Error, params: TParams) => void;
  formatResult?: (raw: unknown) => TData;
}

export interface UseRequestResult<TData, TParams extends unknown[]> {
  data: TData | undefined;
  loading: boolean;
  error: Error | undefined;
  run: (...params: TParams) => void;
  runAsync: (...params: TParams) => Promise<TData>;
  refresh: () => void;
  mutate: (data: TData | undefined) => void;
}

/**
 * Minimal `useRequest` modelled after the ahooks / Umi API. Only
 * implements the surface the mirrored nuwax code actually uses.
 * Add more options here as new call sites are ported.
 */
export function useRequest<TData = unknown, TParams extends unknown[] = unknown[]>(
  service: (...params: TParams) => Promise<TData>,
  options: UseRequestOptions<TData, TParams> = {},
): UseRequestResult<TData, TParams> {
  const { manual = false, defaultParams, onSuccess, onError, formatResult } = options;

  const [data, setData] = useState<TData | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(!manual);
  const [error, setError] = useState<Error | undefined>(undefined);

  const lastParamsRef = useRef<TParams | undefined>(defaultParams);
  const serviceRef = useRef(service);
  serviceRef.current = service;

  const runAsync = useCallback(
    async (...params: TParams): Promise<TData> => {
      lastParamsRef.current = params;
      setLoading(true);
      setError(undefined);
      try {
        const raw = await serviceRef.current(...params);
        const next = formatResult ? formatResult(raw) : raw;
        setData(next);
        setLoading(false);
        onSuccess?.(next, params);
        return next;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setLoading(false);
        onError?.(e, params);
        throw e;
      }
    },
    [formatResult, onError, onSuccess],
  );

  const run = useCallback(
    (...params: TParams): void => {
      void runAsync(...params).catch(() => {
        /* errors surfaced via state + onError */
      });
    },
    [runAsync],
  );

  const refresh = useCallback((): void => {
    if (lastParamsRef.current) {
      run(...lastParamsRef.current);
    }
  }, [run]);

  const mutate = useCallback((next: TData | undefined): void => {
    setData(next);
  }, []);

  useEffect(() => {
    if (!manual) {
      const params = (defaultParams ?? ([] as unknown as TParams)) as TParams;
      run(...params);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, error, run, runAsync, refresh, mutate };
}

/* -------------------------------------------------------------------------- */
/*  useModel                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Stub for Umi's `useModel`. agent-workbench replaces all `useModel`
 * call sites with explicit props / context providers during Phase B.
 * This intentionally throws so unported call sites are caught loudly.
 */
export function useModel(namespace: string): never {
  throw new Error(
    `[compat/umi] useModel('${namespace}') is not implemented in agent-workbench. ` +
      `Port the call site to explicit props or a context provider. See NUWAX_SYNC.md.`,
  );
}
