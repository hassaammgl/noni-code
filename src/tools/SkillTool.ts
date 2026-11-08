import type { SkillStore } from "../skills/SkillStore";
import { Tool } from "./Tool";

const ACTIONS = ["list", "read"] as const;

/**
 * Skill loader: reads instructions stored in `.ai` on demand.
 * The system prompt contains only the index, keeping persona/context small.
 */
export class SkillTool extends Tool {
    name = "skill";
    description =
        "Load a skill: a markdown instruction pack from .ai (tool usage, workflows, project conventions). " +
        "The system prompt only shows the skill index. Before work a skill covers, read it with action=read and follow it. " +
        "action=list shows every skill with its one-line description. " +
        "Read the `tools` skill before using an unfamiliar tool or when a tool call was rejected.";
    parameters = {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: [...ACTIONS],
                description: "list: skill names + descriptions. read (default when name is given): full skill text.",
            },
            name: { type: "string", description: "Skill name for action=read, e.g. \"tools\" or \"workflow\"." },
        },
    };

    constructor(private store: SkillStore) {
        super();
    }

    async run(args: Record<string, any>) {
        const name = String(args.name ?? "").trim();
        const action = String(args.action ?? "").trim().toLowerCase() || (name ? "read" : "list");

        if (action === "list") {
            const skills = this.store.list();
            if (!skills.length) {
                return [
                    "No skills found.",
                    "Add markdown files to .ai/skills/ (project) or ~/.config/noni-chan/.ai/skills (global),",
                    "or point NONI_SKILLS_DIR at a folder.",
                ].join("\n");
            }
            return `Available skills (${skills.length}):\n${this.store.renderList()}\n\nLoad one with skill {"action":"read","name":"..."}.`;
        }

        if (action !== "read") {
            throw new Error(`unknown action: ${action}. Use one of: ${ACTIONS.join(", ")}`);
        }

        if (!name) {
            throw new Error(
                `name is required for action=read. Available: ${this.store.names().join(", ") || "(none)"}`,
            );
        }

        const skill = this.store.get(name);
        if (!skill) {
            throw new Error(
                `unknown skill "${name}". Available: ${this.store.names().join(", ") || "(none)"}. ` +
                    "Use skill {\"action\":\"list\"} to see descriptions.",
            );
        }

        return `# skill: ${skill.name}\n# source: ${skill.source} (${skill.path})\n\n${skill.body}`;
    }
}
