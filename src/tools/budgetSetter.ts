import { z } from "zod";
import { SetReasoningBudgetInput } from "../types.js";

const InputSchema = z.object({
  token_budget: z.number().positive().max(8000), // Example constraints
});

export async function setReasoningBudgetHandler(rawInput: unknown): Promise<string> {
  const input = InputSchema.parse(rawInput) as SetReasoningBudgetInput;
  
  const instruction = `You MUST use a <think> block for your reasoning, and it must not exceed ${input.token_budget} tokens. Example format:
<think>
- Goal: [Your primary goal for this task]
- Assumptions: [List of assumptions you are making]
- Risk: [The main risk or potential issue]
</think>`;
  
  return instruction;
}