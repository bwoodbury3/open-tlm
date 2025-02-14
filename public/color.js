const INIT_COLOR_MIN = 122;
const INIT_COLOR_MAX = 190;

/**
 * A utility for generating a new color.
 */
export class ColorPicker {
    constructor() {
        this.color_min = INIT_COLOR_MIN;
        this.color_max = INIT_COLOR_MAX;
        this.mask = 0x1
    }

    /**
     * Get a unique color.
     *
     * @returns A unique color.
     */
    next() {
        const r = ((this.mask & 0x4) != 0) ? this.color_max : this.color_min;
        const g = ((this.mask & 0x2) != 0) ? this.color_max : this.color_min;
        const b = ((this.mask & 0x1) != 0) ? this.color_max : this.color_min;

        this.mask += 1;
        if (this.mask >= 7) {
            this.mask = 1;
            this.color_min += 10;
            this.color_max += 10;
        }

        var color = `rgb(${r} ${g} ${b})`;
        return color;
    }

    /**
     * Reset the colors.
     */
    reset() {
        this.mask = 1;
        this.color_min = INIT_COLOR_MIN;
        this.color_max = INIT_COLOR_MAX;
    }
}