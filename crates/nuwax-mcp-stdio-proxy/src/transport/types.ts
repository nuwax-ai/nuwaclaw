/**
 * Transport types
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
  transport: Transport;
}
