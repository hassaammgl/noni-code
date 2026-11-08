import { Tool } from "./Tool";

/** Callback that asks the UI/user for an answer (Tui.ask). */
export type Asker = (question: string, options?: string[]) => Promise<string>;

/**
 * Lets the model ask the user instead of guessing.
 * This tool never blocks on an empty answer: it returns text even if the response is blank.
 */
export class AskUserTool extends Tool {
    name = "ask_user";
    description =
        "Ask the user a question when the request is ambiguous or a decision is theirs (not yours). " +
        "Blocks until they answer. Use options for a small choice, or leave it out for free text.";
    parameters = {
        type: "object",
        properties: {
            question: { type: "string", description: "Short, specific question" },
            options: { type: "array", items: { type: "string" }, description: "Optional choices to pick from" },
        },
        required: ["question"],
    };

    constructor(private ask: Asker) {
        super();
    }

    async run({ question, options }: Record<string, any>) {
        const q = String(question ?? "").trim();
        if (!q) throw new Error("question is empty");
        const choices = Array.isArray(options) ? options.map((o: any) => String(o)).filter(Boolean) : [];
        const answer = String((await this.ask(q, choices)) ?? "").trim();
        return answer || "(user gave no answer)";
    }
}
