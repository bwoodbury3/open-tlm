const LOG_60 = Math.log(60);

/**
 * Manages the scale for a single x-axis.
 */
export class XAxis {
    constructor() {
        this.start_ms = 0;
        this.end_ms = 0;
        this.graph_width = 0;
        this.range = 0;
        this.scale = 0;
    }

    /**
     * Resize/rescale the X axis.
     *
     * @param {*} start_ms The start time (ms).
     * @param {*} end_ms The end time (ms).
     * @param {*} width The graph width in pixels.
     */
    resize(start_ms, end_ms, width) {
        this.start_ms = start_ms;
        this.end_ms = end_ms;
        this.graph_width = width;

        this.range = this.end_ms - this.start_ms;
        this.scale = this.graph_width / this.range;
    }

    /**
     * Retrieve the axis labels. This will be at the scale of the last resize()
     * call.
     *
     * @param {Number} max_labels The max number of labels to produce.
     *
     * @returns The axis labels.
     */
    labels(max_labels) {
        return time_labels(this.start_ms, this.end_ms, max_labels);
    }
}

/**
 * Manages the data for a single y-axis.
 *
 * The Y Axis owns the dataset because (1) it is dynamically scaled based on the
 * data, and (2) datasets can belong to one of many Y Axes. If we don't track it
 * here we'll just end up tracking it somewhere else in the same way.
 */
export class YAxis {
    constructor() {
        this.min_y = 0;
        this.max_y = 0;
        this.range = 0;
        this.scale = 0;
        this.datasets = {};
    }

    /**
     * Add or overwrite the provided dataset to the axis.
     *
     * @param {String} dataset_id The dataset ID.
     * @param {Object} data The data.
     */
    add_dataset(dataset_id, data) {
        this.datasets[dataset_id] = data;
    }

    /**
     * Remove the dataset from this axis.
     *
     * @param {String} dataset_id The dataset ID.
     *
     * @returns The data for this dataset_id.
     */
    remove_dataset(dataset_id) {
        const data = this.datasets[dataset_id];
        delete this.datasets[dataset_id];
        return data;
    }

    /**
     * Returns whether the dataset_id is present in this axis.
     *
     * @param {String} dataset_id The dataset ID.
     *
     * @returns Whether the dataset_id is present in this axis.
     */
    has(dataset_id) {
        return dataset_id in this.datasets;
    }

    /**
     * Get the data for a dataset_id.
     *
     * @param {String} dataset_id The dataset ID.
     *
     * @returns The data.
     */
    get(dataset_id) {
        return this.datasets[dataset_id];
    }

    /**
     * @returns The number of datasets owned by this axis.
     */
    num_datasets() {
        return Object.keys(this.datasets).length;
    }

    /**
     * Resize the y axis from the graph height.
     *
     * @param {XAxis} x_axis The XAxis.
     * @param {Number} height The graph height in pixels.
     */
    resize(x_axis, height) {
        this.min_y = Number.MAX_VALUE;
        this.max_y = Number.MIN_VALUE;

        /*
         * Calculate the y axis bounds from the datasets.
         */
        if (Object.keys(this.datasets).length > 0) {
            for (const dataset_id in this.datasets) {
                const dataset = this.datasets[dataset_id];
                for (const point of dataset.points) {
                    const d = new Date(point.date).getTime();
                    if (d >= x_axis.start_ms && d <= x_axis.end_ms) {
                        this.min_y = Math.min(this.min_y, min_point_value(point));
                        this.max_y = Math.max(this.max_y, max_point_value(point));
                    }
                }
            }
        }

        /*
         * No data; just use 0 and 1.
         */
        if (this.min_y === Number.MAX_VALUE && this.max_y === Number.MIN_VALUE) {

            this.min_y = 0;
            this.max_y = 1;
        }

        /*
         * The y range has to be _something_ in order for label rendering to
         * make sense.
         */
        if (this.max_y === this.min_y) {
            this.min_y -= 5;
            this.max_y += 5;
        }

        /*
         * Grow the bounds by 10% so that points aren't right on the ceiling.
         */
        const y_range_before = this.max_y - this.min_y;
        this.max_y += y_range_before * .05;
        this.min_y -= y_range_before * .05;
        this.range = this.max_y - this.min_y;
        this.scale = height / this.range;
    }

    /**
     * Convert the internal datasets into the pixel coordinate frame. This
     * function assumes the X and Y axes have already been scaled (via resize()).
     *
     * @param {XAxis} x_axis The XAxis.
     */
    get_pixelpoints(x_axis) {
        var pixelpoints = {};
        for (const dataset_id in this.datasets) {
            const dataset = this.datasets[dataset_id];
            const points = dataset.points;

            var pixels = [];
            for (const point of points) {
                const d = new Date(point.date).getTime();
                const x = x_axis.scale * (d - x_axis.start_ms);
                const y = this.scale * (this.max_y - mean_value(point));
                pixels.push([x, y]);
            }

            pixelpoints[dataset_id] = pixels;
        }
        return pixelpoints;
    }

    /**
     * Retrieve the axis labels. This will be at the scale of the last
     * to_pixel_frame() call.
     *
     * @param {Number} max_labels The max number of labels to produce.
     *
     * @returns The axis labels.
     */
    labels(max_labels) {
        return base10_labels(this.min_y, this.max_y, max_labels);
    }
}

/**
 * Get the mean value from a point, if it's an aggregation. Otherwise just get
 * the raw value.
 *
 * @param {*} point
 */
function mean_value(point) {
    if (point.value !== undefined) {
        return point.value;
    } else {
        return point.mean_value;
    }
}

/**
 * Get the min value from a point, if it's an aggregation. Otherwise just get
 * the raw value.
 *
 * @param {*} point
 */
function min_point_value(point) {
    if (point.value !== undefined) {
        return point.value;
    } else {
        return point.min_value;
    }
}

/**
 * Get the max value from a point, if it's an aggregation. Otherwise just get
 * the raw value.
 *
 * @param {*} point
 */
function max_point_value(point) {
    if (point.value !== undefined) {
        return point.value;
    } else {
        return point.max_value;
    }
}

/**
 * Calculates the best axis labels for a particular resolution.
 *
 * @param {Number} min_y The minimum y value.
 * @param {Number} max_y The maximum y value.
 * @param {Number} max_labels The max number of labels that will fit on the axis.
 *
 * @returns {Array<Number>} The axis labels.
 */
function base10_labels(min_y, max_y, max_labels) {
    if (max_y - min_y === 0) {
        return [];
    }

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
function time_labels(min_x, max_x, max_labels) {
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
    if (x_range_ms === 0) {
        return [];
    } else if (x_range_ms < 1000 * 2) {
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