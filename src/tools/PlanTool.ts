import { parseOutline, type TodoStore } from "../todos/TodoStore";
import type { PlanMode } from "../plan/PlanMode";
import { Tool } from "./Tool";

const MAX_PLAN_CHARS = 6_000;

/**
 * Plan mode se bahar nikalne ka approved raasta.
 * User plan approve kare to mode OFF ho jata hai aur plan todo list ban jata hai.
 */
export class ExitPlanTool extends Tool {
    name = "exit_plan";
    description =
        "Plan mode only: submit the proposed plan and ask the user to approve it. " +
        "On approval plan mode turns off, write tools unlock and the plan becomes the todo list. " +
        "Use a short nested outline: \"1. Change\\n  1.1 File\\n2. Verify\".";
    parameters = {
        type: "object",
        properties: {
            plan: {
                type: "string",
                description:
                    "Proposed plan as an indented outline (two spaces = subtask). Be specific: files, changes, verification.",
            },
        },
        required: ["plan"],
    };

    constructor(
        private mode: PlanMode,
        private todos: TodoStore,
        private approve: (plan: string) => Promise<boolean>,
    ) {
        super();
    }

    async run(args: Record<string, any>) {
        if (!this.mode.on) {
            return "Plan mode is already OFF. Execute the approved work with the normal tools.";
        }

        const text = String(args.plan ?? "").trim();
        if (!text) {
            throw new Error(
                'plan is required, e.g. {"plan":"1. Inspect auth\\n  1.1 src/auth.ts\\n2. Fix and test"}',
            );
        }

        const plan = text.length > MAX_PLAN_CHARS ? text.slice(0, MAX_PLAN_CHARS) : text;
        const approved = await this.approve(plan);
        if (!approved) {
            return (
                "User rejected the plan. Plan mode stays ON — nothing was changed. " +
                "Ask what to adjust, revise the plan, and call exit_plan again."
            );
        }

        this.mode.set(false);

        // Approved plan ko todo list bana do, taake execution track ho
        let saved = "";
        try {
            const tree = parseOutline(plan);
            if (tree.length) {
                this.todos.clear();
                for (const task of tree) this.todos.add(task);
                saved = `\n${this.todos.render()}`;
            }
        } catch {
            // free-form plan: todos skip, approval phir bhi valid
        }

        return (
            "Plan approved — plan mode is OFF and write tools are unlocked. " +
            "Execute it now, step by step, without stopping to ask: " +
            'todo {"action":"next"} -> do that step -> todo {"action":"done","id":"..."} -> next. ' +
            "Keep going until every todo is done, then report what changed and what you verified." +
            saved
        );
    }
}
