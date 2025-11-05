declare module 'hidefile' {
  function hide(path: string, callback: (err: Error | null) => void): void;
  function hideSync(path: string): void;
  function show(path: string, callback: (err: Error | null) => void): void;
  function showSync(path: string): void;
  function isHidden(path: string, callback: (err: Error | null, hidden: boolean) => void): void;
  function isHiddenSync(path: string): boolean;
}

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
