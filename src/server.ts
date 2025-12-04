import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { setReasoningBudgetHandler, logReasoningReflectionHandler, searchLearningsHandler, revertReasoningTransactionHandler } from "./tools/budgetSetter.js";

class BudgetSetterServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "systematic-reasoning-ai-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error: any) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // Handler for listing available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "set_reasoning_budget",
          description: "Takes a task description and (optionally) a token budget, then returns a string instruction for an AI to reason adaptively.",
          inputSchema: {
            type: "object",
            properties: {
              workspace_path: { type: "string", description: "The absolute path of the project's workspace directory." },
              task_description: { type: "string", description: "A description of the task to be performed." },
              token_budget: { type: "number", description: "The maximum number of tokens for the <think> block." },
            },
            required: ["workspace_path", "task_description", "token_budget"],
          },
        },
        {
          name: "log_reasoning_reflection",
          description: "Logs the outcome of a reasoning cycle to the memory log.",
          inputSchema: {
            type: "object",
            properties: {
              workspace_path: { type: "string", description: "The absolute path of the project's workspace directory." },
              reasoning_ticket_id: { type: "string", description: "The UUID of the reasoning cycle to complete." },
              task: { type: "string", description: "The original task description." },
              outcome: { type: "string", enum: ["success", "failure"], description: "The outcome of the task." },
              learning: { type: "string", description: "A concise lesson learned from the reasoning cycle." },
            },
            required: ["workspace_path", "reasoning_ticket_id", "task", "outcome", "learning"],
          },
        },
        {
          name: "search_learnings",
          description: "Searches the learning bank for past reflections within the current project.",
          inputSchema: {
            type: "object",
            properties: {
              workspace_path: { type: "string", description: "The absolute path of the project's workspace directory." },
              query: { type: "string", description: "Keywords to search for in past learnings." },
              limit: { type: "number", description: "The maximum number of results to return. Defaults to 5." },
            },
            required: ["workspace_path", "query"],
          },
        },
        {
          name: "revert_reasoning_transaction",
          description: "Reverts a reasoning transaction, removing the ticket and any associated learning logs. Use this to recover from a corrupted or unwanted state.",
          inputSchema: {
            type: "object",
            properties: {
              workspace_path: { type: "string", description: "The absolute path of the project's workspace directory." },
              reasoning_ticket_id: { type: "string", description: "The UUID of the reasoning cycle to revert." },
            },
            required: ["workspace_path", "reasoning_ticket_id"],
          },
        },
      ],
    }));

    // Handler for calling the tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'set_reasoning_budget':
          try {
            const instruction = await setReasoningBudgetHandler(request.params.arguments);
            return {
              content: [{ type: 'text', text: instruction }],
            };
          } catch (error: any) {
            console.error(`Error calling ${request.params.name}:`, error);
            return {
              content: [{ type: 'text', text: `Error in tool ${request.params.name}: ${error.message}` }],
              isError: true,
            };
          }
        
        case 'log_reasoning_reflection':
          try {
            await logReasoningReflectionHandler(request.params.arguments);
            return {
              content: [{ type: 'text', text: "Reflection logged successfully." }],
            };
          } catch (error: any) {
            console.error(`Error calling ${request.params.name}:`, error);
            return {
              content: [{ type: 'text', text: `Error in tool ${request.params.name}: ${error.message}` }],
              isError: true,
            };
          }
        
        case 'search_learnings':
            try {
                const results = await searchLearningsHandler(request.params.arguments);
                return {
                    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                };
            } catch (error: any) {
                console.error(`Error calling ${request.params.name}:`, error);
                return {
                    content: [{ type: 'text', text: `Error in tool ${request.params.name}: ${error.message}` }],
                    isError: true,
                };
            }
        
        case 'revert_reasoning_transaction':
            try {
                await revertReasoningTransactionHandler(request.params.arguments);
                return {
                    content: [{ type: 'text', text: "Transaction reverted successfully." }],
                };
            } catch (error: any) {
                console.error(`Error calling ${request.params.name}:`, error);
                return {
                    content: [{ type: 'text', text: `Error in tool ${request.params.name}: ${error.message}` }],
                    isError: true,
                };
            }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${request.params.name}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[systematic-reasoning-ai-mcp] Server running on stdio.');
  }
}

const server = new BudgetSetterServer();
server.run().catch((err) => {
  console.error("[systematic-reasoning-ai-mcp] Fatal:", err);
  process.exit(1);
});
