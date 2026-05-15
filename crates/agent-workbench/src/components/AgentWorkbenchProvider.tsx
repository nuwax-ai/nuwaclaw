import { createContext, useContext, useMemo } from 'react';
import { createMockApiAdapter } from '../adapters/mockApiAdapter';
import { createWebApiAdapter } from '../adapters/webApiAdapter';
import type {
  AgentWorkbenchConfig,
  AgentWorkbenchProviderProps,
  WorkbenchAdapterMode,
  WorkbenchApiAdapter,
} from '../types';

interface AgentWorkbenchContextValue {
  adapter: WorkbenchApiAdapter;
  config: AgentWorkbenchConfig;
  mode: WorkbenchAdapterMode;
  missingConfig: string[];
}

const AgentWorkbenchContext = createContext<AgentWorkbenchContextValue | null>(null);

function resolveAdapter(config: AgentWorkbenchConfig): {
  adapter: WorkbenchApiAdapter;
  mode: WorkbenchAdapterMode;
  missingConfig: string[];
} {
  if (config.apiAdapter) {
    return { adapter: config.apiAdapter, mode: 'custom', missingConfig: [] };
  }

  const missingConfig = [
    !config.baseUrl ? 'baseUrl' : null,
    !config.accessToken ? 'accessToken' : null,
  ].filter((item): item is string => Boolean(item));

  if (config.useMock || missingConfig.length > 0) {
    return {
      adapter: createMockApiAdapter({ latencyMs: config.mockLatencyMs }),
      mode: 'mock',
      missingConfig,
    };
  }

  return {
    adapter: createWebApiAdapter({
      baseUrl: config.baseUrl as string,
      accessToken: config.accessToken as string,
    }),
    mode: 'web',
    missingConfig,
  };
}

export function AgentWorkbenchProvider({
  config,
  children,
}: AgentWorkbenchProviderProps) {
  const value = useMemo<AgentWorkbenchContextValue>(() => {
    const resolved = resolveAdapter(config);
    return {
      ...resolved,
      config,
    };
  }, [config]);

  return (
    <AgentWorkbenchContext.Provider value={value}>
      {children}
    </AgentWorkbenchContext.Provider>
  );
}

export function useAgentWorkbenchContext(): AgentWorkbenchContextValue {
  const context = useContext(AgentWorkbenchContext);
  if (!context) {
    throw new Error('AgentWorkbench must be rendered inside AgentWorkbenchProvider');
  }
  return context;
}

export function useOptionalAgentWorkbenchContext(): AgentWorkbenchContextValue | null {
  return useContext(AgentWorkbenchContext);
}
