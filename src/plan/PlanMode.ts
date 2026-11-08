/** Plan mode ka shared switch. TUI aur web server ek hi instance use karte hain. */
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
