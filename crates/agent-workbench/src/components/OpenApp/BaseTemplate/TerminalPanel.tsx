import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { WorkbenchHostBridge } from '../../../types';
import { Icon } from '../icons';

interface Props {
  conversationId: string;
  hostBridge?: WorkbenchHostBridge;
  onClose: () => void;
}

const encodeInput = (data: string) => {
  const bytes = new TextEncoder().encode(data);
  const result = new Uint8Array(bytes.length + 1);
  result[0] = 0x30;
  result.set(bytes, 1);
  return result;
};

export function TerminalPanel({ conversationId, hostBridge, onClose }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [expanded, setExpanded] = useState(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const [reconnectToken, setReconnectToken] = useState(0);

  const reconnect = useCallback(() => {
    setReconnectToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let disposed = false;
    let resize: ResizeObserver | undefined;
    void Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/xterm/css/xterm.css'),
    ]).then(([{ Terminal }, { FitAddon }]) => {
      if (disposed) return;
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        lineHeight: 1.35,
        fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
        theme: { background: '#101217', foreground: '#e8eaed', cursor: '#7ab7ff' },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(viewport);
      terminalRef.current = terminal;
      fitRef.current = fit;
      setTerminalReady(true);
      requestAnimationFrame(() => fit.fit());
      resize = new ResizeObserver(() => {
        try { fit.fit(); } catch { /* container may be transitioning */ }
      });
      resize.observe(viewport);
    }).catch(() => {
      if (!disposed) setStatus('error');
    });
    return () => {
      disposed = true;
      resize?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      setTerminalReady(false);
    };
  }, []);

  useEffect(() => {
    if (!terminalReady) return;
    let cancelled = false;
    let inputSubscription: { dispose: () => void } | undefined;
    let resizeSubscription: { dispose: () => void } | undefined;
    setStatus('connecting');
    const connect = async () => {
      const getConnection = hostBridge?.getTerminalConnection;
      if (!getConnection) {
        setStatus('error');
        return;
      }
      try {
        const connection = await getConnection({ conversationId });
      if (cancelled || !connection) return;
      const socket = new WebSocket(connection.url, connection.protocols);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;
      socket.onopen = () => {
        const terminal = terminalRef.current;
        if (!terminal) return;
        const fit = fitRef.current;
        try { fit?.fit(); } catch { /* ignore */ }
        socket.send(JSON.stringify({ columns: terminal.cols || 80, rows: terminal.rows || 24 }));
        inputSubscription = terminal.onData((data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(encodeInput(data));
        });
        resizeSubscription = terminal.onResize(({ cols, rows }) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(`1${JSON.stringify({ columns: cols, rows })}`);
        });
        terminal.focus();
        setStatus('connected');
      };
      socket.onmessage = async (event) => {
        const bytes = typeof event.data === 'string'
          ? new TextEncoder().encode(event.data)
          : new Uint8Array(event.data instanceof Blob ? await event.data.arrayBuffer() : event.data);
        if (bytes[0] === 0x30) terminalRef.current?.write(new TextDecoder().decode(bytes.subarray(1)));
      };
      socket.onerror = () => setStatus('error');
      socket.onclose = () => { if (!cancelled) setStatus('disconnected'); };
      } catch {
        if (!cancelled) setStatus('error');
      }
    };
    void connect();
    return () => {
      cancelled = true;
      inputSubscription?.dispose();
      resizeSubscription?.dispose();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [conversationId, hostBridge, reconnectToken, terminalReady]);

  return (
    <section className={expanded ? 'open-app-terminal-panel expanded' : 'open-app-terminal-panel'}>
      <header>
        <strong><Icon name="terminal" /> 终端</strong>
        <span className={`open-app-terminal-status ${status}`}>{status === 'connected' ? '已连接' : status === 'connecting' ? '连接中…' : '已断开'}</span>
        <div>
          {(status === 'disconnected' || status === 'error') && <button type="button" onClick={reconnect}>重连</button>}
          <button type="button" title={expanded ? '还原' : '展开'} onClick={() => setExpanded((value) => !value)}>↗</button>
          <button type="button" title="关闭" onClick={onClose}><Icon name="close" /></button>
        </div>
      </header>
      <div className="open-app-terminal-viewport" ref={viewportRef} />
    </section>
  );
}
