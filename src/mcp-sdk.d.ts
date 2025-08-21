declare module "@modelcontextprotocol/sdk" {
  export type ToolOptions = {
    name: string;
    description?: string;
    inputSchema?: any;
    outputSchema?: any;
    handler: (ctx: { input: any }) => Promise<any> | any;
  };

  export class Server {
    constructor(opts?: { name?: string; version?: string });
    addTool(tool: ToolOptions): void;
    start(): Promise<void>;
  }

  export default Server;
}
