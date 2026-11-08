/** Shared plan-mode switch used by the TUI and web server. */
export class PlanMode {
    private value: boolean;

    constructor(initial = false) {
        this.value = !!initial;
    }

    get on(): boolean {
        return this.value;
    }

    set(value: boolean): boolean {
        this.value = !!value;
        return this.value;
    }

    toggle(): boolean {
        this.value = !this.value;
        return this.value;
    }
}
