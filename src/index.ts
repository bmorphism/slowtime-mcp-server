#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { timekeeper } from './timekeeper.js';
import { timeLockManager } from './timelock.js';
import { timeVault } from './timevault.js';

const server = new Server(
  {
    name: 'slowtime-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_vault_history',
      description: 'List historical timevault entries with filtering options',
      inputSchema: {
        type: 'object',
        properties: {
          interval_id: {
            type: 'string',
            description: 'Filter by interval ID',
          },
          decrypted_only: {
            type: 'boolean',
            description: 'Show only decrypted entries',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of entries to return',
          },
          offset: {
            type: 'number',
            description: 'Number of entries to skip',
          },
        },
      },
    },
    {
      name: 'get_vault_stats',
      description: 'Get statistics about timevault usage',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'encrypt_with_timelock',
      description: 'Encrypt data that can only be decrypted after a specified interval',
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'string',
            description: 'Data to encrypt',
          },
          interval_id: {
            type: 'string',
            description: 'ID of the interval to use for encryption duration',
          },
        },
        required: ['data', 'interval_id'],
      },
    },
    {
      name: 'decrypt_timelock',
      description: 'Attempt to decrypt time-locked data',
      inputSchema: {
        type: 'object',
        properties: {
          timelock_id: {
            type: 'string',
            description: 'ID of the timelock to decrypt',
          },
        },
        required: ['timelock_id'],
      },
    },
    {
      name: 'list_timelocks',
      description: 'List all timelocks and their status',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'start_interval',
      description: 'Start a new slowtime interval',
      inputSchema: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'Label for the interval',
          },
          duration: {
            type: 'number',
            description: 'Duration in minutes',
          },
        },
        required: ['label', 'duration'],
      },
    },
    {
      name: 'check_interval',
      description: 'Check the status of an interval',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Interval ID',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'list_intervals',
      description: 'List all intervals',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['all', 'active', 'completed'],
            description: 'Filter intervals by status',
          },
        },
      },
    },
    {
      name: 'pause_interval',
      description: 'Pause an active interval',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Interval ID',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'resume_interval',
      description: 'Resume a paused interval',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Interval ID',
          },
        },
        required: ['id'],
      },
    },
  ],
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case 'start_interval': {
        const label = args.label as string | undefined;
        const duration = args.duration as number | undefined;
        if (!label || typeof duration !== 'number') {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid parameters');
        }
        const interval = timekeeper.createInterval({
          label,
          duration: duration * 60 * 1000, // Convert minutes to milliseconds
        });
        const progress = await timekeeper.getIntervalProgress(interval);
        return {
          content: [
            {
              type: 'text',
              text: `Started interval "${progress.label}" (ID: ${progress.id})\nDuration: ${args.duration} minutes\nStatus: ${progress.status}`,
            },
          ],
        };
      }

      case 'check_interval': {
        const id = args.id as string | undefined;
        if (!id) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing interval ID');
        }
        const interval = timekeeper.getInterval(id);
        if (!interval) {
          throw new McpError(ErrorCode.InvalidParams, 'Interval not found');
        }
        const progress = await timekeeper.getIntervalProgress(interval);
        const remainingMinutes = Math.ceil(progress.remainingTime / (60 * 1000));
        const progressPercent = Math.round(progress.progress * 100);
        return {
          content: [
            {
              type: 'text',
              text: `Interval "${progress.label}" (ID: ${progress.id})\nStatus: ${progress.status}\nProgress: ${progressPercent}%\nRemaining time: ${remainingMinutes} minutes`,
            },
          ],
        };
      }

      case 'list_intervals': {
        const status = (args.status as string | undefined) || 'all';
        let intervals;
        switch (status) {
          case 'active':
            intervals = await timekeeper.listActiveIntervals();
            break;
          case 'completed':
            intervals = await timekeeper.listCompletedIntervals();
            break;
          default:
            intervals = await timekeeper.listIntervals();
        }

        if (intervals.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No intervals found',
              },
            ],
          };
        }

        const intervalList = intervals.map(interval => {
          const remainingMinutes = Math.ceil(interval.remainingTime / (60 * 1000));
          const progressPercent = Math.round(interval.progress * 100);
          return `- "${interval.label}" (ID: ${interval.id})\n  Status: ${interval.status}\n  Progress: ${progressPercent}%\n  Remaining: ${remainingMinutes} minutes`;
        }).join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: intervalList,
            },
          ],
        };
      }

      case 'pause_interval': {
        const id = args.id as string | undefined;
        if (!id) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing interval ID');
        }
        const success = await timekeeper.pauseInterval(id);
        if (!success) {
          throw new McpError(ErrorCode.InvalidParams, 'Failed to pause interval');
        }
        const interval = timekeeper.getInterval(id);
        if (!interval) {
          throw new McpError(ErrorCode.InvalidParams, 'Interval not found');
        }
        const progress = await timekeeper.getIntervalProgress(interval);
        return {
          content: [
            {
              type: 'text',
              text: `Paused interval "${progress.label}" (ID: ${progress.id})`,
            },
          ],
        };
      }

      case 'resume_interval': {
        const id = args.id as string | undefined;
        if (!id) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing interval ID');
        }
        const success = await timekeeper.resumeInterval(id);
        if (!success) {
          throw new McpError(ErrorCode.InvalidParams, 'Failed to resume interval');
        }
        const interval = timekeeper.getInterval(id);
        if (!interval) {
          throw new McpError(ErrorCode.InvalidParams, 'Interval not found');
        }
        const progress = await timekeeper.getIntervalProgress(interval);
        return {
          content: [
            {
              type: 'text',
              text: `Resumed interval "${progress.label}" (ID: ${progress.id})`,
            },
          ],
        };
      }

      case 'encrypt_with_timelock': {
        const data = args.data as string | undefined;
        const intervalId = args.interval_id as string | undefined;
        if (!data || !intervalId) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters');
        }

        const interval = timekeeper.getInterval(intervalId);
        if (!interval) {
          throw new McpError(ErrorCode.InvalidParams, 'Interval not found');
        }

        const progress = await timekeeper.getIntervalProgress(interval);
        const remainingTime = progress.remainingTime;

        try {
          const timeLock = await timeLockManager.encryptForInterval(data, remainingTime);
          return {
            content: [
              {
                type: 'text',
                text: `Data encrypted with timelock (ID: ${timeLock.id})\nWill be decryptable when interval "${interval.label}" completes`,
              },
            ],
          };
        } catch (error) {
          throw new McpError(ErrorCode.InternalError, `Encryption failed: ${error}`);
        }
      }

      case 'decrypt_timelock': {
        const timelockId = args.timelock_id as string | undefined;
        if (!timelockId) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing timelock ID');
        }

        try {
          const decrypted = await timeLockManager.attemptDecryption(timelockId);
          if (decrypted === null) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'The data is not yet decryptable. Please wait until the associated interval completes.',
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `Decrypted data: ${decrypted}`,
              },
            ],
          };
        } catch (error) {
          if (error instanceof Error && error.message === 'TimeLock not found') {
            throw new McpError(ErrorCode.InvalidParams, 'TimeLock not found');
          }
          throw new McpError(ErrorCode.InternalError, `Decryption failed: ${error}`);
        }
      }

      case 'list_timelocks': {
        const timelocks = timeLockManager.listTimeLocks();
        if (timelocks.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No timelocks found',
              },
            ],
          };
        }

        const timelockList = timelocks.map(timelock => {
          const status = timelock.decryptedData ? 'Decrypted' : 'Encrypted';
          return `- Timelock ID: ${timelock.id}\n  Status: ${status}\n  Round Number: ${timelock.roundNumber}`;
        }).join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: timelockList,
            },
          ],
        };
      }

      case 'list_vault_history': {
        const intervalId = args.interval_id as string | undefined;
        const decryptedOnly = args.decrypted_only as boolean | undefined;
        const limit = args.limit as number | undefined;
        const offset = args.offset as number | undefined;

        const vaults = await timeVault.listVaults({
          intervalId,
          decryptedOnly,
          limit,
          offset,
        });

        if (vaults.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No vault entries found',
              },
            ],
          };
        }

        const vaultList = vaults.map(vault => {
          const status = vault.decryptedAt ? 'Decrypted' : 'Encrypted';
          const decryptedTime = vault.decryptedAt 
            ? `\n  Decrypted at: ${new Date(vault.decryptedAt).toISOString()}`
            : '';
          
          return `- Vault ID: ${vault.id}
  Status: ${status}
  Created at: ${new Date(vault.createdAt).toISOString()}${decryptedTime}
  Interval ID: ${vault.intervalId}
  Round Number: ${vault.roundNumber}`;
        }).join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: vaultList,
            },
          ],
        };
      }

      case 'get_vault_stats': {
        const stats = await timeVault.getStats();
        const avgTime = stats.avgDecryptionTime 
          ? `\nAverage decryption time: ${Math.round(stats.avgDecryptionTime)} seconds`
          : '';

        return {
          content: [
            {
              type: 'text',
              text: `Total vaults: ${stats.totalVaults}
Decrypted vaults: ${stats.decryptedVaults}${avgTime}`,
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(ErrorCode.InternalError, `Internal error: ${error}`);
  }
});

// Clean up old data every hour
setInterval(async () => {
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  await timekeeper.cleanupCompletedIntervals(maxAge);
  await timeLockManager.cleanupDecrypted(maxAge);
}, 60 * 60 * 1000);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Slowtime MCP server running on stdio');
