const LOG_60 = Math.log(60);

/**
 * Calculates the best axis labels for a particular resolution.
 *
 * @param {Number} min_y The minimum y value.
 * @param {Number} max_y The maximum y value.
 * @param {Number} max_labels The max number of labels that will fit on the axis.
 *
 * @returns {Array<Number>} The axis labels.
 */
export function base10_labels(min_y, max_y, max_labels) {
    const spacing = base10_interval(min_y, max_y, max_labels);

    let labels = [];
    const first = Math.ceil(min_y / spacing) * spacing;
    for (let i = 0; i < max_labels; ++i) {
        let point = first + spacing * i;
        if (point >= max_y) {
            break;
        }
        labels.push(Number(point.toFixed(2)));
    }

    return labels;
}

/**
 * Calculates the best x axis labels for a particular resolution.
 *
 * @param {Number} min_x The minimum x value [ms].
 * @param {Number} max_x The maximum x value [ms].
 * @param {Number} max_labels The max number of labels that will fit on the axis.
 *
 * @returns {Array<Array<Date, String>>} The axis labels.
 */
export function time_labels(min_x, max_x, max_labels) {
    const x_range_ms = max_x - min_x;
    const beginning_of_day = new Date(min_x).setHours(0, 0, 0, 0);

    let labels = [];
    let spacing = -1;
    let first = -1;
    let converter = undefined;

    /*
     * Units of time obey different rules at different resolutions. In the ms range we
     * want base 10 rules. Until the day range, we want base 60. Above the day range,
     * back to base 10.
     */
    if (x_range_ms < 1000 * 2) {
        /*
         * In the millisecond range, use base 10 milliseconds as the intervals and
         * time-only. as the label
         */
        spacing = base10_interval(min_x, max_x, max_labels);
        first = Math.ceil(min_x / spacing) * spacing;
        converter = date => date.toISOString().split("T")[1];
    } else if (x_range_ms < 1000 * 60 * 60 * 24 * 2) {
        /*
         * Between milliseconds and days, use base 60.
         */
        const t_since_day_start = min_x - beginning_of_day;
        spacing = base60_interval(min_x / 1000, max_x / 1000, max_labels) * 1000;
        first = Math.ceil(t_since_day_start / spacing) * spacing + beginning_of_day;
        converter = date => date.toISOString();
    } else {
        /*
         * Above the day range, use days.
         */
        const ms_per_day = 1000 * 60 * 60 * 24;
        spacing = base10_interval(min_x / ms_per_day, max_x / ms_per_day, max_labels) * ms_per_day;
        first = beginning_of_day;
        converter = date => date.toISOString().split("T")[0];
    }

    /*
     * Used the provided first/spacing above to build the intervals.
     */
    for (let i = 0; i < max_labels; ++i) {
        let timestamp = first + spacing * i;
        if (timestamp >= max_x) {
            break;
        }
        let datestr = converter(new Date(timestamp));
        labels.push([timestamp, datestr]);
    }

    return labels;
}

/**
 * Calculate some good intervals for base 10.
 *
 * @param {Number} min
 * @param {Number} max
 * @param {Number} max_intervals
 *
 * @returns The ideal interval spacing for base 10.
 */
function base10_interval(min, max, max_intervals) {
    const y_range = max - min;
    var spacing = y_range / max_intervals;

    /*
     * Adjust spacing down to between [1, 10).
     */
    var scale_factor = 10 ** Math.floor(Math.log10(spacing));
    var adj_spacing = spacing / scale_factor;

    /*
     * Adjust up the spacing to hit an even multiple of 1 / 2 / 2.5 / 5 / 10
     */
    if (adj_spacing < 2) {
        adj_spacing = 2;
    } else if (adj_spacing < 2.5) {
        adj_spacing = 2.5;
    } else if (adj_spacing < 5) {
        adj_spacing = 5;
    } else {
        adj_spacing = 10.0;
    }

    /*
     * Adjust that spacing back up in to the range of the original values.
     */
    spacing = adj_spacing * scale_factor;

    return spacing;
}

/**
 * Calculate a good interval for base 60.
 *
 * @param {Number} min
 * @param {Number} max
 * @param {Number} max_intervals
 *
 * @returns The ideal interval spacing for base 60.
 */
function base60_interval(min, max, max_intervals) {
    const y_range = max - min;
    var spacing = y_range / max_intervals;

    /*
     * Adjust spacing down to between [1, 60).
     */
    var scale_factor = 60 ** Math.floor(log60(spacing));
    var adj_spacing = spacing / scale_factor;

    /*
     * Adjust up the spacing to hit an even multiple.
     */
    if (adj_spacing < 2) {
        adj_spacing = 2;
    } else if (adj_spacing < 2.5) {
        adj_spacing = 2.5;
    } else if (adj_spacing < 5) {
        adj_spacing = 5;
    } else if (adj_spacing < 10) {
        adj_spacing = 10;
    } else if (adj_spacing < 15) {
        adj_spacing = 15;
    } else if (adj_spacing < 20) {
        adj_spacing = 20;
    } else if (adj_spacing < 30) {
        adj_spacing = 30;
    } else {
        adj_spacing = 60;
    }

    /*
     * Adjust that spacing back up in to the range of the original values.
     */
    spacing = adj_spacing * scale_factor;
    return spacing;
}

function log60(val) {
    return Math.log(val) / LOG_60;
}