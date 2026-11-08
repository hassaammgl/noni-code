import { createInterface } from "node:readline/promises";
import type { AgentUI } from "../agent/Agent";

const esc = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`;
const dim = (s: string) => esc("2", s);
const bold = (s: string) => esc("1", s);
const red = (s: string) => esc("31", s);
const green = (s: string) => esc("32", s);
const yellow = (s: string) => esc("33", s);
const cyan = (s: string) => esc("36", s);

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Tool args ko ek chhoti readable line me: JSON dump ke bajaye. */
function oneLine(value: unknown, max = 110): string {
    const s = String(value ?? "").replace(/\s+/g, " ").trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Tool output lines ki indentation/whitespace preserve karo, bas lambai cap karo. */
function clip(line: string, max: number): string {
    return line.length > max ? `${line.slice(0, Math.max(0, max - 1))}…` : line;
}

function summarizeToolArgs(name: string, args: Record<string, any>): string {
    switch (name) {
        case "bash": {
            const action = String(args.action ?? "run");
            if (action === "run") return oneLine(args.command);
            const bits = [action, args.job_id && `job=${args.job_id}`];
            return oneLine(bits.filter(Boolean).join(" "));
        }
        case "read_file":
        case "list_dir":
        case "write_file":
        case "edit_file":
        case "delete_file":
            return oneLine(args.path ?? "");
        case "glob":
        case "grep":
            return oneLine(args.pattern ?? args.path ?? "");
        case "web_search":
            return oneLine(args.query);
        case "web_fetch":
            return oneLine(args.url);
        case "read_docs": {
            const bits = [args.name, args.language && `(${args.language})`, args.topic && `topic=${args.topic}`];
            return oneLine(bits.filter(Boolean).join(" "));
        }
        case "todo": {
            const bits = [
                args.action,
                args.id && `id=${args.id}`,
                args.parent_id && `parent=${args.parent_id}`,
                args.title && `"${oneLine(args.title, 55)}"`,
                args.outline && "outline",
            ];
            return oneLine(bits.filter(Boolean).join(" "));
        }
        case "system_info":
            return oneLine(args.section ?? "");
        default:
            return oneLine(JSON.stringify(args), 120);
    }
}

export class Tui implements AgentUI {
    private rl = createInterface({ input: process.stdin, output: process.stdout });
    private lineOpen = false;
    private thinkingOpen = false;
    private spinner: ReturnType<typeof setInterval> | null = null;
    private frame = 0;
    private ruleShown = false;

    private get width() {
        return Math.max(40, Math.min(process.stdout.columns || 80, 120));
    }

    private rule() {
        return dim("─".repeat(this.width));
    }

    onExit(cb: () => void) {
        this.rl.on("close", cb);
    }

    close() {
        this.rl.close();
    }

    banner(model: string, tools: number, todos = 0) {
        console.log();
        const plan = todos ? ` ${dim("·")} ${cyan(`${todos} todos`)}` : "";
        console.log(`  ${bold("✻ Noni")} ${dim("·")} ${cyan(model)} ${dim("·")} ${tools} tools${plan}`);
        console.log(`  ${dim("/help  /tools  /todos  /jobs  /client  /plan")}`);
        console.log(`  ${dim("/model <name>  /clear  /skills  /think  /update  /exit")}`);
        console.log(`  ${this.rule()}`);
        this.ruleShown = true;
    }

    /** Startup picker. Khali Enter = default (sabse chhota model). Number ya poora naam dono chalte hain. */
    async chooseModel(models: { name: string; params: string; size: string }[], defaultIndex = 0): Promise<string> {
        const fallback = models[defaultIndex] ?? models[0];
        if (!fallback) throw new Error("no models to choose from");

        this.endLine();
        console.log(`  ${bold("Select model")} ${dim("· Enter = default")}`);
        models.forEach((m, i) => {
            const mark = i === defaultIndex ? cyan("❯") : " ";
            const def = i === defaultIndex ? dim("  ← default") : "";
            console.log(`  ${mark} ${String(i + 1).padStart(2)}. ${m.name}  ${dim(`${m.params} params · ${m.size}`)}${def}`);
        });

        for (let tries = 0; tries < 3; tries++) {
            const answer = (await this.rl.question(`  ${cyan("model")} ${dim(`[1-${models.length}]`)} `)).trim();
            if (!answer) return fallback.name;

            const n = Number(answer);
            if (Number.isInteger(n) && n >= 1 && n <= models.length) return models[n - 1]!.name;

            const named = models.find((m) => m.name === answer);
            if (named) return named.name;

            this.warn(`invalid choice: ${answer}`);
        }

        this.warn(`using default: ${fallback.name}`);
        return fallback.name;
    }

    log(msg: string) {
        this.waitingEnd();
        this.endLine();
        this.ruleShown = false;
        console.log(msg.split("\n").map((line) => dim(`  ${line}`)).join("\n"));
    }

    warn(msg: string) {
        this.waitingEnd();
        this.endLine();
        this.ruleShown = false;
        console.log(msg.split("\n").map((line) => `  ${yellow("⚠")} ${yellow(line)}`).join("\n"));
    }

    error(msg: string) {
        this.waitingEnd();
        this.endLine();
        this.ruleShown = false;
        console.log(msg.split("\n").map((line) => `  ${red("✗")} ${red(line)}`).join("\n"));
    }

    /** Todo tree ko status ke hisaab se color karo. */
    todoTree(text: string) {
        this.waitingEnd();
        this.endLine();
        this.ruleShown = false;
        const colored = text
            .replace(/\[x\]/g, green("[x]"))
            .replace(/\[~\]/g, cyan("[~]"))
            .replace(/\[!\]/g, red("[!]"))
            .replace(/\[ \]/g, dim("[ ]"));
        console.log(colored.split("\n").map((line) => `  ${line}`).join("\n"));
        console.log();
    }

    /** Input bar: ek hi rule, phir ❯ prompt */
    async prompt(): Promise<string> {
        this.waitingEnd();
        this.endLine();
        if (!this.ruleShown) {
            console.log(this.rule());
            this.ruleShown = true;
        }
        const input = await this.rl.question(`${cyan("❯")} `);
        return input.trim();
    }

    /** Agent ka sawaal (ask_user tool): wahi input bar, pr sawaal dikha ke */
    async ask(question: string, options: string[] = []): Promise<string> {
        this.waitingEnd();
        this.endLine();
        this.ruleShown = false;
        console.log(`  ${cyan("?")} ${question}`);
        options.forEach((option, i) => console.log(`    ${String(i + 1).padStart(2)}. ${option}`));
        const answer = (await this.rl.question(`  ${cyan("you")} `)).trim();
        if (options.length && /^\d+$/.test(answer)) return options[Number(answer) - 1] ?? answer;
        return answer;
    }

    /** Spinner jab tak pehla token na aaye */
    waiting(label = "thinking") {
        this.waitingEnd();
        this.endLine();
        if (!process.stdout.isTTY) {
            console.log(dim(`  ${label}...`));
            this.ruleShown = false;
            return;
        }
        this.frame = 0;
        const started = Date.now();
        this.spinner = setInterval(() => {
            const f = SPINNER[this.frame++ % SPINNER.length]!;
            const secs = Math.floor((Date.now() - started) / 1000);
            const elapsed = secs > 0 ? ` ${secs}s` : "";
            process.stdout.write(`\r${dim(`  ${f} ${label}${elapsed}...`)}`);
        }, 80);
    }

    waitingEnd() {
        if (!this.spinner) return;
        clearInterval(this.spinner);
        this.spinner = null;
        process.stdout.write("\r\x1b[2K");
    }

    assistantStart() {
        this.waitingEnd();
        this.endLine();
        this.ruleShown = false;
        process.stdout.write(green("● "));
    }

    assistantDelta(text: string) {
        this.ruleShown = false;
        process.stdout.write(text);
        this.lineOpen = true;
    }

    assistantEnd() {
        process.stdout.write("\n\n");
        this.lineOpen = false;
    }

    thinkingDelta(text: string) {
        this.waitingEnd();
        this.ruleShown = false;
        if (!this.thinkingOpen) {
            this.endLine();
            process.stdout.write(dim("⋯ "));
            this.thinkingOpen = true;
        }
        process.stdout.write(dim(text));
        this.lineOpen = true;
    }

    thinkingEnd() {
        if (!this.thinkingOpen) return;
        process.stdout.write("\n");
        this.thinkingOpen = false;
        this.lineOpen = false;
    }

    private endLine() {
        if (!this.lineOpen) return;
        process.stdout.write("\n");
        this.lineOpen = false;
    }

    toolCall(name: string, args: Record<string, any>) {
        this.waitingEnd();
        this.endLine();
        this.ruleShown = false;
        const detail = summarizeToolArgs(name, args);
        const room = this.width - name.length - 8;
        const body = detail.length > room ? `${detail.slice(0, Math.max(0, room - 1))}…` : detail;
        console.log(`${cyan("⏺")} ${bold(name)}${body ? ` ${dim(body)}` : ""}`);
    }

    toolResult(result: string, isError: boolean) {
        this.waitingEnd();
        this.endLine();
        this.ruleShown = false;

        const lines = result.split("\n").filter((line) => line.trim().length);
        const shown = lines.slice(0, isError ? 5 : 8);
        shown.forEach((line, i) => {
            const text = `  ${i === 0 ? "⎿" : " "} ${clip(line, Math.max(this.width - 6, 240))}`;
            console.log(isError ? red(text) : dim(text));
        });
        if (!shown.length) console.log(dim("  ⎿ (empty)"));
        const more = lines.length - shown.length;
        if (more > 0) console.log(dim(`    … +${more} more lines`));
        console.log();
    }

    async confirmStrict(): Promise<boolean> {
        this.ruleShown = false;
        const a = await this.rl.question(red("  ⚠ RISKY! Pakka chalana hai? Poora 'yes' type karo: "));
        return a.trim().toLowerCase() === "yes";
    }

    async confirm(_name: string, _args: Record<string, any>, preview?: string, warnings: string[] = []): Promise<boolean> {
        this.ruleShown = false;
        if (warnings.length) {
            console.log(red("  ⚠ WARNING, is command me ye problems hain:"));
            for (const w of warnings) console.log(red(`    • ${w}`));
        }
        if (preview) console.log(dim(`  ${preview.replace(/\n/g, "\n  ")}`));
        const a = await this.rl.question(`  ${yellow("Allow?")} ${dim("[y/N]")} `);
        return a.trim().toLowerCase().startsWith("y");
    }

    /** Plan mode: exit_plan ka plan dikha kar approval lo. */
    async approvePlan(plan: string): Promise<boolean> {
        this.ruleShown = false;
        console.log(cyan("  Proposed plan:"));
        console.log(plan.split("\n").map((line) => dim(`    ${line}`)).join("\n"));
        const a = await this.rl.question(`  ${yellow("Approve and execute?")} ${dim("[y/N]")} `);
        return a.trim().toLowerCase().startsWith("y");
    }
}
