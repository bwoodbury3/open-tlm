import { ColorPicker } from "/public/color.js";

const DATA_ENDPOINT = "/api/data/";

/**
 * Class which tracks the state of a zoom.
 */
class Zoomer {
    /**
     * Constructor.
     */
    constructor() {
        this.zoom_threshold = 20;
        this.zooming = false;
        this.axis = "x";
        this.x0 = -1;
        this.y0 = -1;
        this.x1 = -1;
        this.y1 = -1;
    }

    mouse_down(x, y) {
        this.zooming = true;
        this.x0 = x;
        this.y0 = y;
    }

    mouse_drag(x, y) {
        this.x1 = x;
        this.y1 = y;
    }

    mouse_up(x, y) {
        this.zooming = false;

        this.x1 = x;
        this.y1 = y;

        /*
         * Ensure x0 & y0 is always smaller.
         */
        if (this.x1 < this.x0) {
            const tmp = this.x0;
            this.x0 = this.x1;
            this.x1 = tmp;
        }
        if (this.y1 < this.y0) {
            const tmp = this.y0;
            this.y0 = this.y1;
            this.y1 = tmp;
        }
    }

    cancel() {
        this.zooming = false;
    }

    should_zoom() {
        if (this.axis == "x") {
            return Math.abs(this.x1 - this.x0) > this.zoom_threshold;
        }
        if (this.axis == "y") {
            return Math.abs(this.y1 - this.y0) > this.zoom_threshold;
        }
    }
}

/**
 * Graph module.
 */
export class Graph {
    /**
     * Constructor.
     *
     * @param {Element} canvas The graph canvas layer.
     * @param {Element} interact The interactive canvas layer.
     * @param {Element} legend The legend element.
     * @param {Date} start The initial start time range.
     * @param {Date} end The initial end time range.
     * @param {Array<String>} dataset_ids The dataset IDs.
     */
    constructor(canvas, interact, legend, start, end, dataset_ids) {
        this.start = start.getTime();
        this.end = end.getTime();
        this.datasets = {};
        this.colors = {};

        this.color_picker = new ColorPicker();

        /*
         * Initialize the canvas.
         */
        this.canvas = canvas;
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
        this.ctx = this.canvas.getContext("2d");

        /*
         * Initialize the interactive layer.
         */
        this.interact = interact;
        this.interact.width = this.interact.offsetWidth;
        this.interact.height = this.interact.offsetHeight;
        this.interact_ctx = this.interact.getContext("2d");

        /*
         * Initialize the legend.
         */
        this.legend = legend;
        this.legend.style.visibility = "hidden";

        /*
         * Initialize the zoom tool.
         */
        this.zoomer = new Zoomer();
        this.interact.addEventListener("mousedown", event => this._zoom_start(event));
        this.interact.addEventListener("mouseup", event => this._zoom_end(event));
        this.interact.addEventListener("mouseleave", event => this._zoom_cancel());
        this.interact.addEventListener("mousemove", event => this._zoom_move(event));
        this.interact.addEventListener("wheel", event => this._zoom_mousewheel(event));

        addEventListener("resize", event => this._on_resize());

        for (const dataset_id of dataset_ids) {
            this._fetch(dataset_id);
        }
    }

    /**
     * Add a new dataset ID to the graph.
     *
     * @param {String} dataset_id The dataset ID.
     */
    add_dataset(dataset_id) {
        this._fetch(dataset_id);
    }

    /**
     * Remove a dataset ID from the graph.
     *
     * @param {String} dataset_id The dataset ID.
     */
    remove_dataset(dataset_id) {
        delete this.datasets[dataset_id];
        this._graph_layer();
    }

    /**
     * Refresh the data for all datasets.
     */
    _refresh() {
        for (const dataset_id in this.datasets) {
            this._fetch(dataset_id);
        }
    }

    /**
     * Fetch data for a particular dataset.
     *
     * @param {String} dataset_id The dataset to fetch.
     */
    _fetch(dataset_id) {
        const params = new URLSearchParams({
            start: new Date(this.start).toISOString(),
            end: new Date(this.end).toISOString(),
        });
        const endpoint = `${DATA_ENDPOINT}/${dataset_id}?${params}`;

        fetch(endpoint)
            .then(response => response.json())
            .then(response => {
                const data = response.data;
                if (data.dataset === undefined || data.points === undefined) {
                    console.log("Invalid response!");
                    return;
                }
                this.datasets[dataset_id] = data;
                this._graph_layer();
            });
    }

    /*
     * Resize and redraw the canvas.
     */
    _on_resize() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
        this.interact.width = this.interact.offsetWidth;
        this.interact.height = this.interact.offsetHeight;
        this._graph_layer();
    }

    /*
     * Plot all of the datasets on the canvas.
     */
    _graph_layer() {
        /*
         * Prepare canvas for rendering.
         */
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        /*
         * Calculate the y axis range.
         */
        var min_y = Number.MAX_VALUE;
        var max_y = Number.MIN_VALUE;
        for (const dataset_id in this.datasets) {
            const dataset = this.datasets[dataset_id];
            for (const point of dataset.points) {
                const value = point.value;
                min_y = Math.min(min_y, value);
                max_y = Math.max(max_y, value);
            }
        }

        const x_range = this.end - this.start;
        var y_range = max_y - min_y;

        /*
         * Grow the y_range by 10%.
         */
        max_y += y_range * .05;
        min_y -= y_range * .05;
        y_range = max_y - min_y;

        const x_scale = this.canvas.width / x_range;
        const y_scale = this.canvas.height / y_range;

        /*
         * Draw all of the paths.
         */
        for (const dataset_id in this.datasets) {
            const dataset = this.datasets[dataset_id];
            const points = dataset.points;

            /*
             * Get a color for this dataset.
             */
            if (!(dataset_id in this.colors)) {
                this.colors[dataset_id] = this.color_picker.next();
            }
            this.ctx.strokeStyle = this.colors[dataset_id];

            /*
             * Draw the initial point.
             */
            const d0 = new Date(points[0].date).getTime();
            const x0 = x_scale * (d0 - this.start);
            const y0 = y_scale * (max_y - points[0].value);
            this.ctx.beginPath();
            this.ctx.moveTo(x0, y0);

            /*
             * Draw the subsequent points.
             */
            for (const point of points) {
                const d = new Date(point.date).getTime();
                const x = x_scale * (d - this.start);
                const y = y_scale * (max_y - point.value);

                this.ctx.lineTo(x, y);
            }

            this.ctx.stroke();
        }

        /*
         * Redraw the axis.
         */
        this._axes(min_y, max_y);

        /*
         * Redraw the legend.
         */
        this._legend();
    }

    /**
     * Draw the axes.
     *
     * @param {Number} min_y The min y value.
     * @param {Number} max_y The max y value.
     */
    _axes(min_y, max_y) {
        const margin_px = 10;
        this.ctx.fillStyle = "white";
        this.ctx.font = "15px Arial";

        /*
         * X axis (date).
         */
        const x_points = 7;
        const x_range = this.end - this.start;
        const x_scale = this.canvas.width / x_range;
        const x_dist_px = this.canvas.width - 2 * margin_px;
        const x_step_px = x_dist_px / (x_points - 1);
        for (let i = 0; i < x_points - 1; ++i) {
            const x_px = margin_px + i * x_step_px;
            const x_val = this.start + x_px / x_scale;
            const datestr = new Date(x_val).toISOString();
            this.ctx.fillText(`${datestr}`, x_px, this.canvas.height - margin_px);
        }

        /*
         * Y axis.
         */
        const y_points = 10;
        const y_range = max_y - min_y;
        const y_scale = this.canvas.height / y_range;
        const y_dist_px = this.canvas.height - 2 * margin_px;
        const y_step_px = y_dist_px / (y_points - 1);
        for (let i = 1; i < y_points - 1; ++i) {
            const y_px = margin_px + i * y_step_px;
            const y_val = max_y - y_px / y_scale;
            const valstr = y_val.toFixed(2);
            this.ctx.fillText(`${valstr}`, margin_px, y_px);
        }
    }

    /**
     * Draw the legend.
     */
    _legend() {
        this.legend.innerHTML = "";
        if (Object.keys(this.datasets).length > 0) {
            this.legend.style.visibility = "visible";
        } else {
            this.legend.style.visibility = "hidden";
        }

        /*
         * Render all of the datasets in the legend.
         */
        for (const dataset_id in this.datasets) {
            this.legend.innerHTML += `
                <p id="legend-${dataset_id}"
                   class="clickable mb-0"
                   style="color: ${this.colors[dataset_id]}">
                    ${dataset_id}
                </p>
            `;
        }

        /*
         * Render the handlers.
         */
        for (const dataset_id in this.datasets) {
            const legend_item = document.getElementById(`legend-${dataset_id}`);
            legend_item.onclick = () => this.remove_dataset(dataset_id);
        }
    }

    /**
     * Draw the graph interaction layer.
     */
    _interact_layer() {
        /*
         * Prepare canvas for rendering.
         */
        const height = this.interact.height;
        const width = this.interact.width;
        this.interact_ctx.clearRect(0, 0, width, height);

        /*
         * If we're zooming, grayed out boxes around the areas _not_ affected by the
         * zoom.
         */
        if (this.zoomer.zooming && this.zoomer.should_zoom()) {
            this.interact_ctx.fillStyle = 'rgba(225,225,225,0.2)';

            if (this.zoomer.axis === "x") {
                const min_x = Math.min(this.zoomer.x0, this.zoomer.x1);
                const max_x = Math.max(this.zoomer.x0, this.zoomer.x1);
                this.interact_ctx.fillRect(0, 0, min_x, height);
                this.interact_ctx.fillRect(max_x, 0, width - max_x, height);
            } else if (this.zoomer.axis === "y") {
                const min_y = Math.min(this.zoomer.y0, this.zoomer.y1);
                const max_y = Math.max(this.zoomer.y0, this.zoomer.y1);
                this.interact_ctx.fillRect(0, 0, width, min_y);
                this.interact_ctx.fillRect(0, max_y, width, height - max_y);
            }
        }
    }

    /**
     * Handle the start of a zoom event.
     *
     * @param {*} event
     */
    _zoom_start(event) {
        this.zoomer.mouse_down(event.offsetX, event.offsetY);
    }

    /**
     * Handle the end of a zoom event.
     *
     * @param {*} event
     */
    _zoom_end(event) {
        if (!this.zoomer.zooming) {
            return;
        }

        this.zoomer.mouse_up(event.offsetX, event.offsetY);
        this._interact_layer();

        if (!this.zoomer.should_zoom()) {
            return;
        }


        /*
         * Set the new x axis bounds.
         */
        if (this.zoomer.axis === "x") {
            const x_range = this.end - this.start;
            const x_scale = this.interact.width / x_range;
            this.end = this.start + this.zoomer.x1 / x_scale;
            this.start = this.start + this.zoomer.x0 / x_scale;
        } else {
            /*
             * TODO y axis zoom.
             */
        }

        this._refresh();
    }

    /**
     * Cancel a zoom event.
     */
    _zoom_cancel() {
        this.zoomer.cancel();
        this._interact_layer();
    }

    /**
     * Handle a zoom in progress.
     *
     * @param {*} event
     */
    _zoom_move(event) {
        if (!this.zoomer.zooming) {
            return;
        }

        this.zoomer.mouse_drag(event.offsetX, event.offsetY);
        this._interact_layer();
    }

    /**
     * Zoom handler for the mousewheel.
     *
     * The desired behavior in a mousewheel zoom is that the x coordinate at the cursor
     * remains constant, while the range zooms out by some factor.
     */
    _zoom_mousewheel(event) {
        if (this.zoomer.axis === "y") {
            /*
             * TODO y axis zoom.
             */
            return;
        }

        /*
         * One tick of the wheel is a 5% zoom.
         */
        const zoom_factor = .2;
        const x_range_old = this.end - this.start;
        const x_scale_old = this.interact.width / x_range_old;
        const mouse_x = event.offsetX;
        const mouse_date = this.start + mouse_x / x_scale_old;

        /*
         * Zoom out.
         */
        if (event.deltaY > 0) {
            const x_range_desired = x_range_old * (1 + zoom_factor);
            const x_scale_desired = this.interact.width / x_range_desired;
            this.start = mouse_date -  mouse_x / x_scale_desired;
            this.end = this.start + x_range_desired;
        }

        /*
         * Zoom in.
         */
        if (event.deltaY < 0) {
            const x_range_desired = x_range_old * (1 - zoom_factor);
            const x_scale_desired = this.interact.width / x_range_desired;
            this.start = mouse_date -  mouse_x / x_scale_desired;
            this.end = this.start + x_range_desired;
        }

        this._refresh();
    }
}
