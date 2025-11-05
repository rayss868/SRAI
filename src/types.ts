/**
 * Defines the input for the set_reasoning_budget tool.
 */
export type SetReasoningBudgetInput = {
  workspace_path: string;
  task_description: string;
  token_budget?: number;
};

/**
 * Defines the input for logging a reasoning reflection.
 */
export type LogReasoningReflectionInput = {
  workspace_path: string;
  reasoning_ticket_id: string;
  task: string;
  outcome: 'success' | 'failure';
  learning: string; // A concise lesson learned from the reasoning cycle.
};

/**
 * Represents the state of an active reasoning cycle.
 */
export type ReasoningTicket = {
  id: string;
  workspace_path: string;
  task_description: string;
  status: 'active' | 'completed';
  createdAt: string;
};
