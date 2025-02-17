import { ylabels } from "/public/axes.js";
import { ColorPicker } from "/public/color.js";

const DATA_ENDPOINT = "/api/data/";

/*
 * TODO:
 *      - Multiple axes
 *      - Smarter axes labels (1, 2, 3, ... instead of 0.89, 1.95, 3.01, ...)
 *      - Sharelinks?
 *      - Throttle full refresh requests
 */

/**
 * Graph module.
 */
export class Graph {
    /**
     * Constructor.
     *
     * @param {Date} start The initial start time range.
     * @param {Date} end The initial end time range.
     * @param {Array<String>} dataset_ids The dataset IDs.
     */
    constructor(start, end, dataset_ids) {
        this.start = start.getTime();
        this.end = end.getTime();
        this.datasets = {};
        this.colors = {};
        this.settings = {
            show_points: true,
            point_width: 4,
        }

        this.color_picker = new ColorPicker();

        /*
         * Initialize the canvas.
         */
        this.graph_layer = document.getElementById("layer-graph");
        this.graph_layer.width = this.graph_layer.offsetWidth;
        this.graph_layer.height = this.graph_layer.offsetHeight;
        this.graph_ctx = this.graph_layer.getContext("2d");

        /*
         * Initialize the interactive layer.
         */
        this.interact_layer = document.getElementById("layer-interact");
        this.interact_layer.width = this.interact_layer.offsetWidth;
        this.interact_layer.height = this.interact_layer.offsetHeight;
        this.interact_ctx = this.interact_layer.getContext("2d");

        /*
         * Initialize the legend.
         */
        this.legend = document.getElementById("legend");
        this.legend.style.visibility = "hidden";

        /*
         * Initialize the zoom tool.
         */
        this.zoomer = new Zoomer();
        this.interact_layer.addEventListener("mousedown", event => this._zoom_start(event));
        this.interact_layer.addEventListener("mouseup", event => this._zoom_end(event));
        this.interact_layer.addEventListener("mouseleave", event => this._zoom_cancel());
        this.interact_layer.addEventListener("mousemove", event => this._zoom_move(event));
        this.interact_layer.addEventListener("wheel", event => this._zoom_mousewheel(event));

        /*
         * Initialize the toolbar.
         */
        this.toolbar_zoom_in = document.getElementById("graph-zoom-in");
        this.toolbar_zoom_in.onclick = event => this._zoom_in_button(event);
        this.toolbar_zoom_out = document.getElementById("graph-zoom-out");
        this.toolbar_zoom_out.onclick = event => this._zoom_out_button(event);
        this.toolbar_point_toggle = document.getElementById("graph-point-toggle");
        this.toolbar_point_toggle.onclick = event => this._toggle_points(event);

        /*
         * Initialize the tooltip.
         */
        this.interact_layer.addEventListener("mousemove", event => this._maybe_tooltip(event));
        this.tooltip_div = document.getElementById("tooltip");
        this.tooltip_div.style.visibility = "hidden";
        this.tooltip_value = document.getElementById("tooltip-value");
        this.tooltip_timestamp = document.getElementById("tooltip-timestamp");

        addEventListener("resize", event => this._on_resize());

        for (const dataset_id of dataset_ids) {
            this._fetch(dataset_id);
        }

        this._graph_layer();
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
        this.graph_layer.width = this.graph_layer.offsetWidth;
        this.graph_layer.height = this.graph_layer.offsetHeight;
        this.interact_layer.width = this.interact_layer.offsetWidth;
        this.interact_layer.height = this.interact_layer.offsetHeight;
        this._graph_layer();
    }

    /*
     * Plot all of the datasets on the canvas.
     */
    _graph_layer() {
        /*
         * Prepare canvas for rendering.
         */
        this.graph_ctx.clearRect(0, 0, this.graph_layer.width, this.graph_layer.height);

        /*
         * Everytime the graph is redrawn, we recalculate the datasets in the pixel
         * coordinate frame.
         */
        this._calculate_pixel_coordinate_frame();

        /*
         * Pick all of the colors.
         */
        for (const dataset_id in this.datasets) {
            if (!(dataset_id in this.colors)) {
                this.colors[dataset_id] = this.color_picker.next();
            }
        }

        /*
         * Render the graph!
         */
        for (const dataset_id in this.pixelpoints) {
            const points = this.pixelpoints[dataset_id];

            this.graph_ctx.strokeStyle = this.colors[dataset_id];
            this.graph_ctx.fillStyle = this.colors[dataset_id];

            /*
             * Draw the path.
             */
            this.graph_ctx.beginPath();
            this.graph_ctx.moveTo(points[0][0], points[0][1]);
            for (const point of points) {
                this.graph_ctx.lineTo(point[0], point[1]);
            }
            this.graph_ctx.stroke();

            /*
             * Draw all of the little point circles if asked.
             */
            const point_width = this.settings.point_width;
            if (this.settings.show_points) {
                for (const point of points) {
                    this.graph_ctx.beginPath();
                    this.graph_ctx.arc(point[0], point[1], point_width, 0, 2 * Math.PI, false);
                    this.graph_ctx.fill();
                }
            }
        }

        /*
         * Redraw the axes.
         */
        this._axes();

        /*
         * Redraw the legend.
         */
        this._legend();
    }

    /**
     * Draw the axes.
     */
    _axes() {
        const margin_px = 10;
        this.graph_ctx.fillStyle = "white";
        this.graph_ctx.font = "15px Arial";

        /*
         * X axis (date).
         */
        const x_points = 7;
        const x_dist_px = this.graph_layer.width - 2 * margin_px;
        const x_step_px = x_dist_px / (x_points - 1);
        for (let i = 0; i < x_points - 1; ++i) {
            const x_px = margin_px + i * x_step_px;
            const x_val = this.start + x_px / this.x_scale;
            const datestr = new Date(x_val).toISOString();
            this.graph_ctx.fillText(`${datestr}`, x_px, this.graph_layer.height - margin_px);
        }

        /*
         * Y axis.
         */
        const y_points = 15;
        const y_labels = ylabels(this.min_y, this.max_y, y_points);
        for (const y_label of y_labels) {
            const y_px = this.y_scale * (this.max_y - y_label);
            if (this.graph_layer.height - y_px > 2 * margin_px) {
                this.graph_ctx.fillText(`${y_label}`, margin_px, y_px);
            }
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
        const height = this.interact_layer.height;
        const width = this.interact_layer.width;
        this.interact_ctx.clearRect(0, 0, width, height);

        /*
         * If we're zooming, gray out the area outside the zoom range.
         */
        if (this.zoomer.zooming && this.zoomer.should_zoom()) {
            this.interact_ctx.fillStyle = 'rgba(225,225,225,0.1)';

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
     * Scale all of the `datapoints` into the graph coordinate frame. Sets:
     *      - this.pixelpoints: All of the datapoints in the pixel coordinate frame.
     *          This is a mapping of dataset_id -> list[x,y] coordinates.
     *      - thix.min_y: The minimum y point.
     *      - thix.max_y: The maximum y point.
     *      - this.x_scale: The x axis scale in pixels per millisecond.
     *      - this.y_scale: The y axis scale in pixels per unit.
     *
     * This should be called before re-rendering the graph.
     */
    _calculate_pixel_coordinate_frame() {
        /*
         * Calculate the y axis bounds.
         */
        if (Object.keys(this.datasets).length > 0) {
            this.min_y = Number.MAX_VALUE;
            this.max_y = Number.MIN_VALUE;
            for (const dataset_id in this.datasets) {
                const dataset = this.datasets[dataset_id];
                for (const point of dataset.points) {
                    const value = this._get_value(point);
                    this.min_y = Math.min(this.min_y, value);
                    this.max_y = Math.max(this.max_y, value);
                }
            }
        } else {
            this.max_y = 1;
            this.min_y = 0;
        }

        /*
         * Grow the bounds by 10% so that points aren't right on the ceiling.
         */
        const y_range_before = this.max_y - this.min_y;
        this.max_y += y_range_before * .05;
        this.min_y -= y_range_before * .05;

        const x_range = this.end - this.start;
        const y_range = this.max_y - this.min_y;
        this.x_scale = this.graph_layer.width / x_range;
        this.y_scale = this.graph_layer.height / y_range;

        /*
         * Calculate all of the pixelpoints.
         */
        this.pixelpoints = {};
        for (const dataset_id in this.datasets) {
            const dataset = this.datasets[dataset_id];
            const points = dataset.points;

            var pixels = [];
            for (const point of points) {
                const d = new Date(point.date).getTime();
                const x = this.x_scale * (d - this.start);
                const y = this.y_scale * (this.max_y - this._get_value(point));
                pixels.push([x, y]);
            }
            this.pixelpoints[dataset_id] = pixels;
        }
    }

    /**
     * Extract the value from a point.
     *
     * @param {Object} point The Datapoint object.
     */
    _get_value(point) {
        if (point.value !== undefined) {
            return point.value;
        } else {
            return point.mean_value;
        }
    }

    /**
     * Render a tooltip if the mouse is hovering above a point.
     *
     * @param {*} event
     */
    _maybe_tooltip(event) {
        const point_width = this.settings.point_width;
        const mouse_x = event.offsetX;
        const mouse_y = event.offsetY;

        let active = false;
        let pixelpoint = undefined;
        let datapoint = undefined;
        let dataset = undefined;

        /*
         * Detect mouse collision with any datapoints.
         */
        for (const dataset_id of Object.keys(this.pixelpoints).reverse()) {
            const points = this.pixelpoints[dataset_id];
            for (const i in points) {
                const point = points[i];
                if (Math.abs(mouse_x - point[0]) <= point_width &&
                        Math.abs(mouse_y - point[1]) <= point_width) {
                    active = true;
                    pixelpoint = point;
                    datapoint = this.datasets[dataset_id].points[i];
                    dataset = dataset_id;
                    break;
                }
            }

            if (active) {
                break;
            }
        }

        /*
         * Possibly render the tooltip.
         */
        if (active) {
            this.tooltip_value.innerHTML =
                `<code>${dataset}</code>: <code>${this._get_value(datapoint)}</code>`;
            this.tooltip_timestamp.innerText = new Date(datapoint.date).toISOString();

            /*
             * Find an x,y for the tooltip that fully fits on the screen.
             */
            let x = pixelpoint[0] + 5;
            let y = pixelpoint[1] - this.tooltip_div.offsetHeight / 2;
            if (pixelpoint[0] + this.tooltip_div.offsetWidth > this.graph_layer.width) {
                x = pixelpoint[0] - this.tooltip_div.offsetWidth - 5;
            }
            y = Math.max(0, Math.min(y, this.graph_layer.height - this.tooltip_div.offsetHeight));

            this.tooltip_div.style.left = `${x}px`;
            this.tooltip_div.style.top = `${y}px`;
            this.tooltip_div.style.visibility = "visible";
        } else {
            this.tooltip_div.style.visibility = "hidden";
            this.tooltip_div.style.left = "0px";
            this.tooltip_div.style.top = "0px";
            this.tooltip_value.innerText = "";
            this.tooltip_timestamp.innerText = "";
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
            const x_scale = this.interact_layer.width / x_range;
            this.end = this.start + this.zoomer.x1 / x_scale;
            this.start = this.start + this.zoomer.x0 / x_scale;
        } else {
            /*
             * TODO y axis zoom.
             */
        }

        /*
         * Draw the graph immediately for instant gratificaiton.
         */
        this._graph_layer();
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
     *
     * @param {*} event
     */
    _zoom_mousewheel(event) {
        if (this.zoomer.axis === "y") {
            /*
             * TODO y axis zoom.
             */
            return;
        }

        const zoom_factor = event.deltaY > 0 ? 0.2 : -0.2;
        const mouse_x = event.offsetX;
        this._zoom_once_x(zoom_factor, mouse_x);
    }

    /**
     * Handle the zoom in button from the toolbar.
     *
     * @param {*} event
     */
    _zoom_in_button(event) {
        if (this.zoomer.axis === "y") {
            /*
             * TODO y axis zoom.
             */
            return;
        }

        const zoom_factor = -0.5
        const midpoint_x = this.graph_layer.width / 2;
        this._zoom_once_x(zoom_factor, midpoint_x);
    }

    /**
     * Handle the zoom in button from the toolbar.
     *
     * @param {*} event
     */
    _zoom_out_button(event) {
        if (this.zoomer.axis === "y") {
            /*
             * TODO y axis zoom.
             */
            return;
        }

        const zoom_factor = 0.5
        const midpoint_x = this.graph_layer.width / 2;
        this._zoom_once_x(zoom_factor, midpoint_x);
    }

    /**
     * Zoom once. Positive out, negative in.
     *
     * @param {Number} zoom_factor The percent to zoom.
     * @param {Number} midpoint_x The centerpoint of the zoom in the canvas frame.
     */
    _zoom_once_x(zoom_factor, midpoint_x) {
        /*
         * Calculate the old/new zoom ranges.
         */
        const x_range_old = this.end - this.start;
        const x_scale_old = this.interact_layer.width / x_range_old;
        const x_range_desired = x_range_old * (1 + zoom_factor);
        const x_scale_desired = this.interact_layer.width / x_range_desired;

        /*
         * Calculate the new start/end points relative to the zoom midpoint.
         */
        const mouse_date = this.start + midpoint_x / x_scale_old;
        this.start = mouse_date -  midpoint_x / x_scale_desired;
        this.end = this.start + x_range_desired;

        /*
         * Draw the graph immediately while polling for higher fidelity data.
         */
        this._graph_layer();
        this._refresh();
    }

    /**
     * Toggle the show_points config.
     */
    _toggle_points() {
        this.settings.show_points = !this.settings.show_points;
        this._graph_layer();
    }
}

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
