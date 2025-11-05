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
  token_budget: z.number().positive().max(8000).optional(),
});

const LogReflectionSchema = z.object({
  workspace_path: z.string().min(1),
  reasoning_ticket_id: z.string().uuid(),
  task: z.string(),
  outcome: z.enum(['success', 'failure']),
  learning: z.string(),
});

const SearchLearningsSchema = z.object({
    query: z.string().min(1),
    limit: z.number().positive().optional().default(5),
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

  const universal_token_budget = input.token_budget || 2048;
  const logPath = getLogPathForWorkspace(input.workspace_path);
  let recentLearnings = "";
  try {
      const logData = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
      if (logData.reflections && logData.reflections.length > 0) {
          const learnings = logData.reflections.slice(0, 2).map((r: any) => `  - From task "${r.task}", the learning was: "${r.learning}"`).join("\n");
          recentLearnings = `To give you immediate context, here are the last 2 learnings from this project:\n${learnings}\n\n`;
      }
  } catch (e) { /* No log file yet, which is fine. */ }

  const searchInstruction = `You also have access to a universal learning bank. To search for older or more specific experiences, use the 'search_learnings' tool. For example: <tool_code>
{
  "tool_name": "search_learnings",
  "arguments": {
    "query": "database connection",
    "limit": 3
  }
}
</tool_code>`;

  const instruction = `You are a universal reasoning engine.
${recentLearnings}${searchInstruction}

Your reasoning process is MANDATORY. It must not exceed ${universal_token_budget} tokens.

Follow this exact structure:
<think>
Goal: <Your main objective>
Initial Plan: <Your first draft of the step-by-step plan>
Self-Correction: <Critique your initial plan. What are its weaknesses? How can it be improved?>
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
    const { query, limit } = input;

    const allReflections: any[] = [];

    if (!fs.existsSync(CENTRAL_STORAGE_DIR)) {
        return []; // No storage directory yet, so no learnings to search.
    }

    const projectDirs = fs.readdirSync(CENTRAL_STORAGE_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    for (const projectDirName of projectDirs) {
        const logPath = path.resolve(CENTRAL_STORAGE_DIR, projectDirName, 'learn_log.json');
        if (fs.existsSync(logPath)) {
            try {
                const logData = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
                if (logData.reflections) {
                    // Add project context to each reflection
                    const projectReflections = logData.reflections.map((r: any) => ({
                        ...r,
                        project: projectDirName,
                    }));
                    allReflections.push(...projectReflections);
                }
            } catch (e) {
                console.warn(`Could not read or parse log file: ${logPath}`, e);
            }
        }
    }

    if (allReflections.length === 0) {
        return [];
    }

    // Configure Fuse.js for fuzzy searching
    const fuseOptions = {
        includeScore: true,
        keys: ['task', 'learning', 'outcome'],
        threshold: 0.4, // Adjust this for more or less strictness (0.0 = exact, 1.0 = anything)
    };

    const fuse = new Fuse(allReflections, fuseOptions);

    const searchResults = fuse.search(query);

    // Format and return the results, already sorted by relevance by Fuse.js
    return searchResults
        .slice(0, limit)
        .map(result => ({
            ...result.item,
            score: result.score // Optionally include the relevance score
        }));
}
