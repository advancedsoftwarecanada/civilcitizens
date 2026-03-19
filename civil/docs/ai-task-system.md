# AI Task System

The AI task system provides dedicated, reusable AI endpoints for specific product workflows without routing everything through the generic Civil AI chat flow.

## Why it exists

- Generic Civil AI chat is designed for open-ended assistant conversations.
- Product tasks like marketplace categorization, marketplace description writing, and job description writing need narrow prompts and deterministic output shapes.
- Task endpoints keep these workflows predictable and easier to extend.

## Route shape

- `POST /api/ai/task/:namespace/:task`

Examples:

- `POST /api/ai/task/marketplace/category`
- `POST /api/ai/task/marketplace/description`
- `POST /api/ai/task/jobs/description`

## Request body

```json
{
  "input": {},
  "serverId": "optional-server-id",
  "model": "optional-model-id",
  "temperature": 0.2,
  "topP": 0.9,
  "maxTokens": 1200
}
```

`input` is task-specific and validated against the task definition.

## Response shape

```json
{
  "task": {
    "id": "marketplace/category"
  },
  "result": {},
  "rawText": "{...}",
  "server": {
    "id": "...",
    "name": "..."
  },
  "model": "..."
}
```

`result` is validated task output. `rawText` is included for debugging when the model response needs inspection.

## Prompt files

Prompt files live in:

- `apps/api/prompts/tasks/`

Each task definition points to a matching markdown file. This keeps prompts editable without burying them inside route code.

Examples:

- `apps/api/prompts/tasks/marketplace/category.md`
- `apps/api/prompts/tasks/marketplace/description.md`
- `apps/api/prompts/tasks/jobs/description.md`

## How tasks are defined

Task registry lives in:

- `apps/api/src/aiTasks.ts`

Each task definition contains:

- task id
- prompt file path
- input schema
- output schema
- input-to-prompt formatter

## How to add a new task

1. Add a prompt markdown file under `apps/api/prompts/tasks/...`
2. Add a task definition in `apps/api/src/aiTasks.ts`
3. Define the input schema and output schema
4. Build a compact input formatter for the model
5. Call the endpoint from the relevant UI flow

## Design rules

- Task prompts should be narrow and explicit.
- Tasks should return JSON whenever the client needs structured fields.
- Output must be validated server-side before returning to the client.
- Do not use the generic Civil AI marketplace search flow for structured generation or classification tasks.