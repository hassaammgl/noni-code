import type { AgentUI } from "../agent/Agent";
import type { RuntimeUI } from "../app/Runtime";

export type SseSend = (event: string, data: Record<string, unknown>) => void;

interface Pending {
    resolve: (value: any) => void;
    timer: ReturnType<typeof setTimeout>;
    fallback: any;
}

const WAIT_MS = 5 * 60 * 1000;

/**
 * Converts Agent callbacks into SSE events. Only one client can be attached at a time;
 * confirm/ask responses arrive via HTTP POST.
 */
export class WebAgentUI implements RuntimeUI {
    private sink: SseSend | null = null;
    private pending = new Map<string, Pending>();
    private seq = 0;
    private content = "";
    private last = "";

    attach(send: SseSend) {
        this.sink = send;
        this.content = "";
        this.last = "";
    }

    detach() {
        this.sink = null;
        this.cancelPending();
    }

    /** Final assistant text after the chat turn completes. */
    get lastContent() {
        return this.last;
    }

    resolve(id: string, value: any): boolean {
        const item = this.pending.get(id);
        if (!item) return false;
        clearTimeout(item.timer);
        this.pending.delete(id);
        item.resolve(value);
        return true;
    }

    cancelPending() {
        for (const [id, item] of this.pending) {
            clearTimeout(item.timer);
            this.pending.delete(id);
            item.resolve(item.fallback);
        }
    }

    private emit(event: string, data: Record<string, unknown> = {}) {
        this.sink?.(event, data);
    }

    private request(payload: Record<string, unknown>, fallback: any): Promise<any> {
        return new Promise((resolve) => {
            const id = String(++this.seq);
            const timer = setTimeout(() => this.resolve(id, fallback), WAIT_MS);
            this.pending.set(id, { resolve, timer, fallback });
            this.emit(String(payload.kind), { id, ...payload });
            if (!this.sink) this.resolve(id, fallback);
        });
    }

    assistantStart() {
        this.content = "";
        this.emit("assistant_start");
    }

    assistantDelta(text: string) {
        this.content += text;
        this.emit("delta", { text });
    }

    assistantEnd() {
        this.last = this.content;
        this.emit("assistant_end");
    }

    thinkingDelta(text: string) {
        this.emit("thinking", { text });
    }

    thinkingEnd() {
        this.emit("thinking_end");
    }

    waiting(label?: string) {
        this.emit("waiting", { label: label ?? "" });
    }

    waitingEnd() {
        this.emit("waiting_end");
    }

    toolCall(name: string, args: Record<string, any>) {
        this.emit("tool_call", { name, args });
    }

    toolResult(result: string, isError: boolean) {
        this.emit("tool_result", { result, isError });
    }

    warn(message: string) {
        this.emit("warn", { message });
    }

    confirm(
        name: string,
        args: Record<string, any>,
        preview?: string,
        warnings?: string[],
    ): Promise<boolean> {
        return this.request(
            { kind: "confirm", name, args, preview, warnings, strict: false },
            false,
        );
    }

    confirmStrict(): Promise<boolean> {
        return this.request({ kind: "confirm", strict: true }, false);
    }

    /** exit_plan: show the plan in the browser and collect approve/reject. */
    approvePlan(plan: string): Promise<boolean> {
        return this.request({ kind: "plan", plan }, false);
    }

    ask(question: string, options: string[] = []): Promise<string> {
        const answer = this.request({ kind: "ask", question, options }, "");
        return answer as Promise<string>;
    }
}
