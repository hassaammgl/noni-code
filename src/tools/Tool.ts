import type { Tool as OllamaTool } from "ollama";

export abstract class Tool {
    abstract readonly name: string;
    abstract readonly description: string;
    abstract readonly parameters: Record<string, any>;
    readonly dangerous: boolean = false;

    abstract run(args: Record<string, any>): Promise<string>;

    /** Per-action danger: some actions (e.g. bash status/wait) are safe. */
    dangerousFor(_args: Record<string, any>): boolean {
        return this.dangerous;
    }

    /** List of risky issues. If non-empty, the Agent requires double confirmation. */
    warnings(_args: Record<string, any>): string[] {
        return [];
    }

    /** Optional preview shown before confirmation. */
    preview?(args: Record<string, any>): string | Promise<string>;

    toOllama(): OllamaTool {
        return {
            type: "function",
            function: { name: this.name, description: this.description, parameters: this.parameters as any },
        };
    }
}