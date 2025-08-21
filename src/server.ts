import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { setReasoningBudgetHandler } from "./tools/budgetSetter.js";

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
          description: "Takes a token budget and returns a string instruction for an AI, including an example of the <think> block format.",
          inputSchema: {
            type: "object",
            properties: {
              token_budget: { type: "number", description: "The maximum number of tokens allowed for the <think> block." },
            },
            required: ["token_budget"],
          },
        },
      ],
    }));

    // Handler for calling the tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'set_reasoning_budget') {
        throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${request.params.name}`);
      }

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
