import { z } from "zod";
import { SetReasoningBudgetInput, LogReasoningReflectionInput, ReasoningTicket } from "../types.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { hide } from 'hidefile';
import { fileURLToPath } from 'url';
import Fuse from 'fuse.js';

// --- Centralized Storage Path (ESM-compatible) ---
// All reasoning data will be stored inside the MCP project itself, not in individual workspaces.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CENTRAL_STORAGE_DIR = path.resolve(__dirname, '..', '..', '.reasoning_storage');


// --- Schema Definitions ---
const SetBudgetSchema = z.object({
  workspace_path: z.string().min(1),
  task_description: z.string().min(1),
  token_budget: z.number().positive().max(8000),
});

const LogReflectionSchema = z.object({
  workspace_path: z.string().min(1),
  reasoning_ticket_id: z.string().uuid(),
  task: z.string(),
  outcome: z.enum(['success', 'failure']),
  learning: z.string(),
});

const SearchLearningsSchema = z.object({
    workspace_path: z.string().min(1),
    query: z.string().min(1),
    limit: z.number().positive().optional().default(5),
});

const RevertTransactionSchema = z.object({
  workspace_path: z.string().min(1),
  reasoning_ticket_id: z.string().uuid(),
});

// --- Path and State Management ---

function getProjectDir(workspacePath: string): string {
    const projectHash = crypto.createHash('sha256').update(workspacePath).digest('hex');
    const projectDir = path.resolve(CENTRAL_STORAGE_DIR, projectHash);
    if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
    }
    return projectDir;
}

function getTransactionsFilePath(workspacePath: string): string {
  const projectDir = getProjectDir(workspacePath);
  return path.resolve(projectDir, 'transactions.json');
}

function getLogPathForWorkspace(workspacePath: string): string {
  const projectDir = getProjectDir(workspacePath);
  return path.resolve(projectDir, 'learn_log.json');
}

function readTransactions(filePath: string): ReasoningTicket[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeTransactions(filePath: string, tickets: ReasoningTicket[]): void {
  fs.writeFileSync(filePath, JSON.stringify(tickets, null, 2));
}

// --- Core Tool Handlers ---

export async function setReasoningBudgetHandler(rawInput: unknown): Promise<string> {
  const input = SetBudgetSchema.parse(rawInput) as SetReasoningBudgetInput;
  const transactionsFilePath = getTransactionsFilePath(input.workspace_path);
  const tickets = readTransactions(transactionsFilePath);

  const activeTicket = tickets.find(t => t.status === 'active');
  if (activeTicket) {
    throw new Error(`An active reasoning cycle (ID: ${activeTicket.id}) is already in progress for task "${activeTicket.task_description}". Please complete it by calling 'log_reasoning_reflection' before starting a new one.`);
  }

  const newTicket: ReasoningTicket = {
    id: crypto.randomUUID(),
    workspace_path: input.workspace_path,
    task_description: input.task_description,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  tickets.push(newTicket);
  writeTransactions(transactionsFilePath, tickets);

  // The token budget is now mandatory.
  const universal_token_budget = input.token_budget;

  const instruction = `You are a universal reasoning engine.

Your first step is ALWAYS to research past experiences. Before forming any plan, you MUST use the 'search_learnings' tool to gather context. Use keywords from your current task: "${input.task_description}".

Example 'search_learnings' call:
{
  "tool_name": "search_learnings",
  "arguments": {
    "workspace_path": "${input.workspace_path}",
    "query": "relevant keywords from your task",
    "limit": 5
  }
}

After you have gathered context from your research, your reasoning process is MANDATORY. It must not exceed ${universal_token_budget} tokens.

Follow this exact structure:
<think>
Goal: <Your main objective>
Initial Plan: <Your first draft of the step-by-step plan, INFORMED BY YOUR RESEARCH>
Self-Correction: <Critique your initial plan. Did your research provide a better way? How can it be improved?>
Final Plan: <The improved, final version of your plan>
Decision: <The single, concrete action you will execute now>
Confidence: <A score from 0.0 to 1.0>
</think>

IMPORTANT: After you complete the task, you MUST call 'log_reasoning_reflection' with the ticket ID for this cycle: ${newTicket.id}`;
  
  return instruction;
}

export async function logReasoningReflectionHandler(rawInput: unknown): Promise<void> {
  const input = LogReflectionSchema.parse(rawInput) as LogReasoningReflectionInput;
  const transactionsFilePath = getTransactionsFilePath(input.workspace_path);
  const logPath = getLogPathForWorkspace(input.workspace_path);
  const tickets = readTransactions(transactionsFilePath);

  const ticketIndex = tickets.findIndex(t => t.id === input.reasoning_ticket_id && t.status === 'active');
  if (ticketIndex === -1) {
    throw new Error(`No active reasoning ticket found with ID ${input.reasoning_ticket_id}.`);
  }

  tickets[ticketIndex].status = 'completed';
  writeTransactions(transactionsFilePath, tickets);

  let logData: { reflections: any[] } = { reflections: [] };
  try {
    const fileContent = fs.readFileSync(logPath, 'utf-8');
    // **Crucial Fix:** Check if the file is empty or just whitespace
    if (fileContent.trim()) {
      logData = JSON.parse(fileContent);
    }
  } catch (e) { /* No log file yet, which is fine. */ }

  logData.reflections.unshift({
    reasoning_ticket_id: input.reasoning_ticket_id, // <-- Add ticket ID to the log
    timestamp: new Date().toISOString(),
    task: input.task,
    outcome: input.outcome,
    learning: input.learning,
  });

  if (logData.reflections.length > 20) {
    logData.reflections = logData.reflections.slice(0, 20);
  }
  fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
}

export async function searchLearningsHandler(rawInput: unknown): Promise<any[]> {
    const input = SearchLearningsSchema.parse(rawInput);
    const { workspace_path, query, limit } = input;

    const logPath = getLogPathForWorkspace(workspace_path);
    const reflections: any[] = [];

    if (fs.existsSync(logPath)) {
        try {
            const fileContent = fs.readFileSync(logPath, 'utf-8');
            if (fileContent.trim()) {
                const logData = JSON.parse(fileContent);
                if (logData.reflections && logData.reflections.length > 0) {
                    reflections.push(...logData.reflections);
                }
            }
        } catch (e) {
            console.warn(`Could not read or parse log file for project: ${logPath}`, e);
            return []; // Return empty on error to avoid inconsistent state
        }
    }

    if (reflections.length === 0) {
        return [];
    }

    // Configure Fuse.js for fuzzy searching
    const fuseOptions = {
      includeScore: true,
      keys: ['task', 'learning', 'outcome'],
      threshold: 0.6, // Be more lenient with OR queries
      useExtendedSearch: true, // Crucially enable extended search
    };
    
    const fuse = new Fuse(reflections, fuseOptions);
    
    // Explicitly create an OR query by joining words with '|'
    const orQuery = query.trim().split(/\s+/).join('|');
    
    const searchResults = fuse.search(orQuery);

    // Format and return the results
    return searchResults
        .slice(0, limit)
        .map(result => ({
            ...result.item,
            score: result.score
        }));
}

export async function revertReasoningTransactionHandler(rawInput: unknown): Promise<void> {
  const input = RevertTransactionSchema.parse(rawInput);
  const { workspace_path, reasoning_ticket_id } = input;

  const transactionsFilePath = getTransactionsFilePath(workspace_path);
  const logPath = getLogPathForWorkspace(workspace_path);

  // 1. Revert the transaction ticket
  const tickets = readTransactions(transactionsFilePath);
  const newTickets = tickets.filter(t => t.id !== reasoning_ticket_id);

  if (tickets.length === newTickets.length) {
    // Optional: throw an error or just warn if the ticket to revert wasn't found.
    // For idempotency, we can just proceed silently.
    console.warn(`Attempted to revert ticket ${reasoning_ticket_id}, but it was not found in ${transactionsFilePath}.`);
  } else {
    writeTransactions(transactionsFilePath, newTickets);
    console.log(`Reverted and removed ticket ${reasoning_ticket_id}.`);
  }

  // 2. Revert the associated learning log entry
  if (fs.existsSync(logPath)) {
    try {
      const logData = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
      if (logData.reflections) {
        // The log now includes the ticket ID, so we can use it to find the entry.
        const newReflections = logData.reflections.filter((r: any) => r.reasoning_ticket_id !== reasoning_ticket_id);
        
        if (logData.reflections.length !== newReflections.length) {
          logData.reflections = newReflections;
          fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
          console.log(`Reverted and removed learning reflection associated with ticket ${reasoning_ticket_id}.`);
        }
      }
    } catch (e) {
      console.error(`Error processing log file ${logPath} during revert:`, e);
      // Decide if we should throw an error or just log it. Logging is safer.
    }
  }
}
