import { ColorPicker } from "/public/color.js";
import { TaskQueue } from "/public/tasks.js";

const DATA_ENDPOINT = "/api/data";

/**
 * A single dataset to render in the histogram.
 */
export class HistogramDatasetEntry {
    /**
     * Constructor.
     *
     * @param {String} dataset_id The dataset ID.
     * @param {Object} data The data.
     * @param {String} color The color of the bars.
     */
    constructor(dataset_id, data, color) {
        this.dataset_id = dataset_id;
        this.data = data;
        this.color = color;
    }
}

/**
 * Histogram module.
 *
 * Unlike the graph, the histogram is completely stateless. You re-render at your
 * leisure with any array of data you want.
 */
export class Histogram {
    /**
     * Constructor.
     *
     * @param {String} canvas The canvas to render on.
     */
    constructor(canvas) {
        this.settings = {
            max_num_bars: 30,
            px_between_bars: 4,
        };

        /*
         * Initialize the canvas.
         */
        this.histogram_layer = document.getElementById(canvas);
        this.histogram_layer.width = this.histogram_layer.offsetWidth;
        this.histogram_layer.height = this.histogram_layer.offsetHeight;
        this.histogram_ctx = this.histogram_layer.getContext("2d");
    }

    /**
     * Render a single dataset on the canvas.
     *
     * @param {HistogramDatasetEntry} dataset The dataset to render.
     * @param {Number} start The start date to filter.
     * @param {Number} end The end date to filter.
     */
    render_one(dataset, start, end) {
        if (dataset.data.points.length === 0) {
            return;
        }

        /*
         * Copy and sort the data.
         */
        const data = []
        for (const point of dataset.data.points) {
            const d = new Date(point.date).getTime();
            if (d > start && d < end) {
                data.push(mean_value(point));
            }
        }
        data.sort((a, b) => a - b);

        /*
         * Get the min, max, and number of distinct values.
         */
        const min = data[0];
        const max = data[data.length - 1];
        var num_distinct_values = 0;
        var last = undefined;
        for (const val of data) {
            if (val != last) {
                num_distinct_values += 1;
                last = val;
            }
        }

        /*
         * Bin the data into buckets.
         */
        const num_buckets = Math.min(num_distinct_values, this.settings.max_num_bars);
        const bucket_width = (max - min) / num_buckets;
        const buckets = [];
        var data_index = 0;
        var max_count = 0;
        for (var i = 0; i < num_buckets; i += 1) {
            const bucket = {
                min: min + (i * bucket_width),
                max: min + ((1 + i) * bucket_width),
                count: 0,
            }

            for (; data_index < data.length; data_index += 1) {
                if (data[data_index] >= bucket.max) {
                    break;
                }
                bucket.count += 1;
            }

            max_count = Math.max(bucket.count, max_count);
            buckets.push(bucket);
        }

        const width = this.histogram_layer.width;
        const height = this.histogram_layer.height;
        const bar_width = Math.floor(width / num_buckets);
        const bar_padding = this.settings.px_between_bars / 2;
        const pixel_height_per_count = 0.9 * height / max_count;

        this.clear();
        this.histogram_ctx.fillStyle = dataset.color;

        for (const i in buckets) {
            const left = i * bar_width + bar_padding;
            const width = bar_width - bar_padding * 2;
            const bottom = height;
            const top = bottom - buckets[i].count * pixel_height_per_count;

            this.histogram_ctx.fillRect(left, top, width, bottom - top);
        }
    }

    /**
     * Clear the histogram.
     */
    clear() {
        this.histogram_ctx.clearRect(0, 0, this.histogram_layer.width, this.histogram_layer.height);
    }

    /**
     * Render all of the histograms on the canvas.
     *
     * @param {Array<HistogramDatasetEntry>} datasets The datasets to render.
     */
    render_all(datasets) {
        // TODO
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
