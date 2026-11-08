import { createInterface } from "node:readline/promises";
import type { AgentUI } from "../agent/Agent";

const ESC = "\x1b[";
const reset = `${ESC}0m`;
const style = (code: string, text: string) => `${ESC}${code}m${text}${reset}`;

const styles = {
  bold: (s: string) => style("1", s),
  dim: (s: string) => style("2", s),
  italic: (s: string) => style("3", s),
  underline: (s: string) => style("4", s),
  red: (s: string) => style("31", s),
  green: (s: string) => style("32", s),
  yellow: (s: string) => style("33", s),
  blue: (s: string) => style("34", s),
  magenta: (s: string) => style("35", s),
  cyan: (s: string) => style("36", s),
  gray: (s: string) => style("90", s),
  bgCyan: (s: string) => style("46;30", s),
};

const { bold, dim, italic, red, green, yellow, cyan, gray, magenta } = styles;

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function tty() {
  return Boolean(process.stdout.isTTY);
}

function columns() {
  return Math.max(56, Math.min(process.stdout.columns || 96, 132));
}

function stripAnsi(input: string) {
  return input.replace(/\x1b\[[0-9;]*m/g, "");
}

function truncate(text: string, max: number): string {
  if (max <= 1) return "…";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function oneLine(value: unknown, max = 120): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return truncate(text, max);
}

function clip(line: string, max: number): string {
  return truncate(line.replace(/\t/g, "  "), max);
}

function padRight(text: string, width: number) {
  const len = stripAnsi(text).length;
  return len >= width ? text : `${text}${" ".repeat(width - len)}`;
}

function summarizeToolArgs(name: string, args: Record<string, any>): string {
  switch (name) {
    case "bash": {
      const action = String(args.action ?? "run");
      if (action === "run") return oneLine(args.command, 140);
      const parts = [action, args.job_id ? `job=${args.job_id}` : "", args.timeout_seconds ? `${args.timeout_seconds}s` : ""];
      return oneLine(parts.filter(Boolean).join(" · "), 140);
    }
    case "read_file":
    case "list_dir":
    case "write_file":
    case "edit_file":
    case "replace_lines":
    case "delete_file":
    case "move_file":
    case "make_dir":
      return oneLine(args.path ?? args.from ?? "", 140);
    case "glob":
    case "grep":
      return oneLine([args.pattern, args.path].filter(Boolean).join(" in "), 140);
    case "web_search":
      return oneLine(args.query, 140);
    case "web_fetch":
      return oneLine(args.url, 140);
    case "read_docs": {
      const parts = [args.name, args.language ? `(${args.language})` : "", args.topic ? `topic=${args.topic}` : ""];
      return oneLine(parts.filter(Boolean).join(" "), 140);
    }
    case "todo": {
      const parts = [
        args.action,
        args.id ? `#${args.id}` : "",
        args.parent_id ? `parent=${args.parent_id}` : "",
        args.title ? `"${oneLine(args.title, 48)}"` : "",
        args.outline ? "outline" : "",
      ];
      return oneLine(parts.filter(Boolean).join(" "), 140);
    }
    case "git":
      return oneLine([args.action, args.args].flat().filter(Boolean).join(" "), 140);
    case "skill":
      return oneLine([args.action, args.name].filter(Boolean).join(" "), 140);
    case "system_info":
      return oneLine(args.section ?? "summary", 140);
    case "exit_plan":
      return "proposed plan";
    default:
      return oneLine(JSON.stringify(args), 140);
  }
}

function formatDuration(ms: number) {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export class Tui implements AgentUI {
  private rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty() });
  private lineOpen = false;
  private thinkingOpen = false;
  private assistantOpen = false;
  private spinner: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private ruleShown = false;
  private currentModel = "";
  private currentTools = 0;

  private get width() {
    return columns();
  }

  private rule(char = "─") {
    return gray(char.repeat(this.width));
  }

  onExit(cb: () => void) {
    this.rl.on("close", cb);
  }

  close() {
    this.spinnerEnd();
    this.rl.close();
  }

  banner(model: string, tools: number, todos = 0) {
    this.currentModel = model;
    this.currentTools = tools;
    const inner = this.width - 2;
    const title = bold(" NONI ");
    const meta = [
      cyan(model),
      `${tools} tools`,
      todos ? yellow(`${todos} todos`) : "",
    ]
      .filter(Boolean)
      .join(gray("  ·  "));
    const subtitle = dim(" local agentic coding CLI  ·  Ollama  ·  Bun ");
    console.log();
    console.log(gray(`┌${"─".repeat(inner)}┐`));
    console.log(gray("│") + padRight(` ${title}${gray("│")} ${meta}`, inner) + gray("│"));
    console.log(gray("│") + padRight(` ${subtitle}`, inner) + gray("│"));
    console.log(gray(`└${"─".repeat(inner)}┘`));
    this.hints([
      ["/help", "commands"],
      ["/tools", "tool list"],
      ["/plan", "read-only mode"],
      ["/todos", "task tree"],
      ["/client on", "web UI"],
      ["/model", "switch model"],
    ]);
    console.log(this.rule());
    this.ruleShown = true;
  }

  private hints(items: [string, string][]) {
    const chunks = items.map(([cmd, desc]) => `${cyan(cmd)} ${dim(desc)}`);
    const line = `  ${chunks.join(gray("  ·  "))}`;
    if (stripAnsi(line).length <= this.width) {
      console.log(line);
      return;
    }
    console.log(`  ${chunks.slice(0, 3).join(gray("  ·  "))}`);
    console.log(`  ${chunks.slice(3).join(gray("  ·  "))}`);
  }

  async chooseModel(
    models: { name: string; params: string; size: string }[],
    defaultIndex = 0,
  ): Promise<string> {
    const fallback = models[defaultIndex] ?? models[0];
    if (!fallback) throw new Error("no models to choose from");

    this.flushLine();
    console.log();
    console.log(`  ${bold("Select model")} ${dim("— Enter keeps the default")}`);
    console.log(`  ${this.rule("·")}`);
    models.forEach((m, i) => {
      const active = i === defaultIndex;
      const mark = active ? cyan("❯") : dim(" ");
      const idx = dim(String(i + 1).padStart(2));
      const name = active ? bold(m.name) : m.name;
      const details = dim(`${m.params} · ${m.size}`);
      const tag = active ? cyan(" default") : "";
      console.log(`  ${mark} ${idx}  ${name}  ${details}${tag}`);
    });
    console.log(`  ${this.rule("·")}`);

    for (let tries = 0; tries < 3; tries++) {
      const answer = (await this.rl.question(`  ${cyan("model")} ${dim(`[1-${models.length}, Enter=default]`)} ${gray("›")} `)).trim();
      if (!answer) return fallback.name;

      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= models.length) return models[n - 1]!.name;

      const exact = models.find((m) => m.name === answer);
      if (exact) return exact.name;
      const partial = models.find((m) => m.name.toLowerCase().includes(answer.toLowerCase()));
      if (partial) return partial.name;

      this.warn(`invalid choice: ${answer}`);
    }

    this.warn(`using default: ${fallback.name}`);
    return fallback.name;
  }

  log(msg: string) {
    this.spinnerEnd();
    this.flushLine();
    this.ruleShown = false;
    for (const line of String(msg).split("\n")) {
      console.log(`  ${dim("│")} ${dim(clip(line, this.width - 6))}`);
    }
  }

  warn(msg: string) {
    this.spinnerEnd();
    this.flushLine();
    this.ruleShown = false;
    for (const line of String(msg).split("\n")) {
      console.log(`  ${yellow("⚠")} ${yellow(clip(line, this.width - 6))}`);
    }
  }

  error(msg: string) {
    this.spinnerEnd();
    this.flushLine();
    this.ruleShown = false;
    for (const line of String(msg).split("\n")) {
      console.log(`  ${red("✗")} ${red(clip(line, this.width - 6))}`);
    }
  }

  todoTree(text: string) {
    this.spinnerEnd();
    this.flushLine();
    this.ruleShown = false;
    console.log(`  ${bold("Plan")}`);
    const colored = String(text)
      .split("\n")
      .map((line) => {
        if (line.includes("[x]")) return green(line.replace(/\[x\]/g, "[✓]"));
        if (line.includes("[~]")) return cyan(line.replace(/\[~\]/g, "[•]"));
        if (line.includes("[!]")) return red(line.replace(/\[!\]/g, "[!]"));
        if (line.includes("[ ]")) return dim(line);
        return line;
      });
    for (const line of colored) console.log(`  ${dim("│")} ${clip(line, this.width - 6)}`);
    console.log();
  }

  async prompt(): Promise<string> {
    this.spinnerEnd();
    this.flushLine();
    if (!this.ruleShown) {
      console.log(this.rule());
      this.ruleShown = true;
    }
    const prefix = this.currentModel ? dim(` ${this.currentModel} `) : "";
    const input = await this.rl.question(`${cyan("❯")}${prefix}${gray("›")} `);
    this.ruleShown = false;
    return input.trim();
  }

  async ask(question: string, options: string[] = []): Promise<string> {
    this.spinnerEnd();
    this.flushLine();
    this.ruleShown = false;
    console.log();
    console.log(`  ${cyan("?")} ${bold(clip(question, this.width - 6))}`);
    options.forEach((option, i) => {
      console.log(`    ${dim(String(i + 1).padStart(2))} ${option}`);
    });
    const hint = options.length ? dim(`[1-${options.length} or text]`) : dim("[text]");
    const answer = (await this.rl.question(`  ${cyan("↳")} ${hint} ${gray("›")} `)).trim();
    if (options.length && /^\d+$/.test(answer)) return options[Number(answer) - 1] ?? answer;
    return answer;
  }

  waiting(label = "thinking") {
    this.spinnerEnd();
    this.flushLine();
    if (!tty()) {
      console.log(dim(`  … ${label}`));
      this.ruleShown = false;
      return;
    }
    this.frame = 0;
    const started = Date.now();
    this.spinner = setInterval(() => {
      const glyph = SPINNER[this.frame++ % SPINNER.length]!;
      const elapsed = formatDuration(Date.now() - started);
      const text = dim(`  ${glyph} ${label} ${gray(`· ${elapsed}`)}`);
      process.stdout.write(`\r\x1b[2K${text}`);
    }, 80);
  }

  waitingEnd() {
    this.spinnerEnd();
  }

  private spinnerEnd() {
    if (!this.spinner) return;
    clearInterval(this.spinner);
    this.spinner = null;
    if (tty()) process.stdout.write("\r\x1b[2K");
  }

  assistantStart() {
    this.spinnerEnd();
    this.flushLine();
    this.ruleShown = false;
    this.assistantOpen = true;
    process.stdout.write(`  ${green("●")} `);
  }

  assistantDelta(text: string) {
    this.ruleShown = false;
    if (!this.assistantOpen) this.assistantStart();
    const lines = String(text).split("\n");
    lines.forEach((line, i) => {
      if (i > 0) process.stdout.write(`\n    ${line}`);
      else process.stdout.write(line);
    });
    this.lineOpen = true;
  }

  assistantEnd() {
    if (this.lineOpen || this.assistantOpen) process.stdout.write("\n\n");
    this.lineOpen = false;
    this.assistantOpen = false;
  }

  thinkingDelta(text: string) {
    this.spinnerEnd();
    this.ruleShown = false;
    if (!this.thinkingOpen) {
      this.flushLine();
      process.stdout.write(`  ${magenta("⋯")} ${dim("thought")} ${gray("·")} `);
      this.thinkingOpen = true;
    }
    process.stdout.write(italic(gray(String(text).replace(/\n+/g, " "))));
    this.lineOpen = true;
  }

  thinkingEnd() {
    if (!this.thinkingOpen) return;
    process.stdout.write("\n");
    this.thinkingOpen = false;
    this.lineOpen = false;
  }

  private flushLine() {
    if (!this.lineOpen) return;
    process.stdout.write("\n");
    this.lineOpen = false;
  }

  toolCall(name: string, args: Record<string, any>) {
    this.spinnerEnd();
    this.flushLine();
    this.ruleShown = false;
    const detail = summarizeToolArgs(name, args);
    const label = `${cyan("⏺")} ${bold(name)}`;
    const room = Math.max(20, this.width - stripAnsi(label).length - 4);
    const body = detail ? ` ${gray(truncate(detail, room))}` : "";
    console.log(`  ${label}${body}`);
  }

  toolResult(result: string, isError: boolean) {
    this.spinnerEnd();
    this.flushLine();
    this.ruleShown = false;

    const raw = String(result ?? "");
    const lines = raw.split("\n").filter((line, idx, arr) => !(idx === arr.length - 1 && line === ""));
    const meaningful = lines.filter((line) => line.trim().length > 0);
    const shown = meaningful.slice(0, isError ? 6 : 10);
    const max = Math.max(40, this.width - 8);

    if (!shown.length) {
      console.log(`    ${gray("⎿")} ${dim("(empty)")}`);
      console.log();
      return;
    }

    shown.forEach((line, i) => {
      const prefix = i === 0 ? gray("⎿") : gray(" ");
      const text = clip(line, max);
      console.log(`    ${prefix} ${isError ? red(text) : dim(text)}`);
    });
    const more = meaningful.length - shown.length;
    if (more > 0) console.log(`      ${gray(`… +${more} more lines`)}`);
    console.log();
  }

  async confirmStrict(): Promise<boolean> {
    this.ruleShown = false;
    console.log();
    console.log(`  ${red("!")} ${bold(red("Risky command"))} ${dim("— this needs explicit confirmation")}`);
    const answer = await this.rl.question(`  ${red("type")} ${bold("yes")} ${dim("to continue, anything else cancels")} ${gray("›")} `);
    return answer.trim().toLowerCase() === "yes";
  }

  async confirm(_name: string, _args: Record<string, any>, preview?: string, warnings: string[] = []): Promise<boolean> {
    this.ruleShown = false;
    console.log();
    console.log(`  ${yellow("?")} ${bold("Approval required")}`);
    if (warnings.length) {
      for (const warning of warnings) {
        console.log(`    ${red("•")} ${red(clip(warning, this.width - 8))}`);
      }
    }
    if (preview) {
      console.log(`    ${gray("┌ preview")}`);
      for (const line of String(preview).split("\n").slice(0, 14)) {
        console.log(`    ${gray("│")} ${dim(clip(line, this.width - 8))}`);
      }
      const previewLines = String(preview).split("\n").length;
      if (previewLines > 14) console.log(`    ${gray("│")} ${dim(`… +${previewLines - 14} more lines`)}`);
      console.log(`    ${gray("└")}`);
    }
    const answer = await this.rl.question(`  ${yellow("allow")} ${dim("[y/N]")} ${gray("›")} `);
    return answer.trim().toLowerCase().startsWith("y");
  }

  async approvePlan(plan: string): Promise<boolean> {
    this.ruleShown = false;
    console.log();
    console.log(`  ${cyan("◎")} ${bold("Proposed plan")}`);
    console.log(`  ${this.rule("·")}`);
    for (const line of String(plan).split("\n")) {
      const text = clip(line, this.width - 6);
      if (/^\s*\d+(\.\d+)*[.)]/.test(line)) console.log(`  ${cyan(text)}`);
      else if (/^\s*[-*]/.test(line)) console.log(`  ${dim(text)}`);
      else console.log(`  ${text}`);
    }
    console.log(`  ${this.rule("·")}`);
    const answer = await this.rl.question(`  ${yellow("approve and execute")} ${dim("[y/N]")} ${gray("›")} `);
    return answer.trim().toLowerCase().startsWith("y");
  }
}
