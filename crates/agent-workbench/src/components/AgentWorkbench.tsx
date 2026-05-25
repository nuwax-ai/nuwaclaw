import type { AgentWorkbenchProps } from '../types';
import {
  AgentWorkbenchProvider,
  useOptionalAgentWorkbenchContext,
} from './AgentWorkbenchProvider';
import { NuwaxOpenApp } from './NuwaxOpenApp';

export function AgentWorkbench(props: AgentWorkbenchProps) {
  const context = useOptionalAgentWorkbenchContext();

  if (props.config && !context) {
    return (
      <AgentWorkbenchProvider config={props.config}>
        <div className={props.className} style={props.style}>
          <NuwaxOpenApp />
        </div>
      </AgentWorkbenchProvider>
    );
  }

  if (!context) {
    return (
      <AgentWorkbenchProvider config={{ agentId: '', useMock: true }}>
        <div className={props.className} style={props.style}>
          <NuwaxOpenApp />
        </div>
      </AgentWorkbenchProvider>
    );
  }

  return (
    <div
      className={props.className}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...props.style }}
    >
      <NuwaxOpenApp />
    </div>
  );
}
