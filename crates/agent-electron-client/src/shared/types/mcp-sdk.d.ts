/**
 * Type declarations for @modelcontextprotocol/sdk subpath imports.
 *
 * TypeScript with moduleResolution: "node" doesn't fully support package.json "exports"
 * or "typesVersions" with .js extension imports in declaration files.
 * These declarations provide the types needed by the main process.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare module '@modelcontextprotocol/sdk/client' {
  import type { Readable, Writable } from 'stream';

  export interface Implementation {
    name: string;
    version: string;
  }

  export interface ClientOptions {
    capabilities?: Record<string, any>;
  }

  export interface RequestOptions {
    timeout?: number;
    signal?: AbortSignal;
  }

  export class Client {
    constructor(clientInfo: Implementation, options?: ClientOptions);
    connect(transport: any, options?: RequestOptions): Promise<void>;
    close(): Promise<void>;
    listTools(params?: any, options?: RequestOptions): Promise<{ tools: any[] }>;
    callTool(params: { name: string; arguments?: Record<string, unknown> }, resultSchema?: any, options?: RequestOptions): Promise<any>;
    getServerCapabilities(): any;
  }
}

declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  import type { Readable } from 'stream';

  export interface StdioServerParameters {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    stderr?: 'pipe' | 'inherit' | 'ignore';
    cwd?: string;
  }

  export class StdioClientTransport {
    constructor(server: StdioServerParameters);
    start(): Promise<void>;
    close(): Promise<void>;
    send(message: any): Promise<void>;
    get stderr(): Readable | null;
    get pid(): number | null;
    sessionId?: string;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: any, extra?: any) => void;
  }
}

declare module '@modelcontextprotocol/sdk/server' {
  export interface Implementation {
    name: string;
    version: string;
  }

  export interface ServerOptions {
    capabilities?: {
      tools?: Record<string, any>;
      prompts?: Record<string, any>;
      resources?: Record<string, any>;
    };
    instructions?: string;
  }

  export class Server {
    constructor(serverInfo: Implementation, options?: ServerOptions);
    connect(transport: any): Promise<void>;
    close(): Promise<void>;
    setRequestHandler(schema: any, handler: (request: any, extra?: any) => any): void;
    registerCapabilities(capabilities: any): void;
  }
}

declare module '@modelcontextprotocol/sdk/server/streamableHttp.js' {
  import type { IncomingMessage, ServerResponse } from 'http';

  export interface StreamableHTTPServerTransportOptions {
    sessionIdGenerator?: (() => string) | undefined;
    eventStore?: any;
  }

  export class StreamableHTTPServerTransport {
    constructor(options?: StreamableHTTPServerTransportOptions);
    start(): Promise<void>;
    close(): Promise<void>;
    send(message: any, options?: any): Promise<void>;
    handleRequest(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void>;
    get sessionId(): string | undefined;
    set onclose(handler: (() => void) | undefined);
    set onerror(handler: ((error: Error) => void) | undefined);
    set onmessage(handler: ((message: any, extra?: any) => void) | undefined);
    get onclose(): (() => void) | undefined;
    get onerror(): ((error: Error) => void) | undefined;
    get onmessage(): ((message: any, extra?: any) => void) | undefined;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  import type { Readable, Writable } from 'stream';

  export class StdioServerTransport {
    constructor(stdin?: Readable, stdout?: Writable);
    start(): Promise<void>;
    close(): Promise<void>;
    send(message: any): Promise<void>;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: any) => void;
  }
}

declare module '@modelcontextprotocol/sdk/client/streamableHttp.js' {
  export interface StreamableHTTPClientTransportOptions {
    reconnectionOptions?: {
      maxReconnectionDelay?: number;
      initialReconnectionDelay?: number;
      reconnectionDelayGrowFactor?: number;
      maxRetries?: number;
    };
    sessionId?: string;
  }

  export class StreamableHTTPClientTransport {
    constructor(url: URL, opts?: StreamableHTTPClientTransportOptions);
    start(): Promise<void>;
    close(): Promise<void>;
    send(message: any, options?: any): Promise<void>;
    get sessionId(): string | undefined;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: any) => void;
  }
}

declare module '@modelcontextprotocol/sdk/types.js' {
  export interface Tool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
  }

  export const ListToolsRequestSchema: any;
  export const CallToolRequestSchema: any;
  export const ListToolsResultSchema: any;
  export const CallToolResultSchema: any;
}
