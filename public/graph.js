import { base10_labels, time_labels } from "/public/axes.js";
import { ColorPicker } from "/public/color.js";
import { TaskQueue } from "/public/tasks.js";

const DATA_ENDPOINT = "/api/data";

/*
 * TODO:
 *
 * UX improvements
 *      - Multiple axes
 *      - Collapse or resize the searchbar
 *      - Remember settings in cookies
 *
 * System features
 *      - X axis inline notes.
 *          - Maybe adding a note on a telemetry point?
 *      - Sharelinks?
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
            mouse_mode: MouseMode.ZOOM,
            show_grid: true,
            show_points: true,
            point_width: 4,
            min_zoom_threshold: 20,
        };

        this.color_picker = new ColorPicker();
        this.refresh_task_queue = new TaskQueue(1, 1);

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
        this.drag_state = new DragState();
        this.interact_layer.addEventListener("mousedown", event => this._mouse_down(event));
        this.interact_layer.addEventListener("mouseup", event => this._mouse_up(event));
        this.interact_layer.addEventListener("mouseleave", event => this._mouse_leave());
        this.interact_layer.addEventListener("mousemove", event => this._mouse_move(event));
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
        this.toolbar_grid_toggle = document.getElementById("graph-grid-toggle");
        this.toolbar_grid_toggle.onclick = event => this._toggle_grid(event);
        this.toolbar_mouse_zoom = document.getElementById("graph-mouse-zoom");
        this.toolbar_mouse_zoom.onclick = event => this._set_mouse_mode(MouseMode.ZOOM);
        this.toolbar_mouse_pan = document.getElementById("graph-mouse-pan");
        this.toolbar_mouse_pan.onclick = event => this._set_mouse_mode(MouseMode.PAN);
        this.toolbar_refresh = document.getElementById("graph-refresh");
        this.toolbar_refresh.onclick = event => this._refresh();

        /*
         * Initialize the tooltip.
         */
        this.interact_layer.addEventListener("mousemove", event => this._maybe_tooltip(event));
        this.tooltip_div = document.getElementById("tooltip");
        this.tooltip_div.style.visibility = "hidden";
        this.tooltip_value = document.getElementById("tooltip-value");
        this.tooltip_timestamp = document.getElementById("tooltip-timestamp");

        addEventListener("resize", event => this.resize());

        this._toolbar();
        this._refresh();
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

    /*
     * Resize and redraw the canvas.
     */
    resize() {
        this.graph_layer.width = this.graph_layer.offsetWidth;
        this.graph_layer.height = this.graph_layer.offsetHeight;
        this.interact_layer.width = this.interact_layer.offsetWidth;
        this.interact_layer.height = this.interact_layer.offsetHeight;
        this._graph_layer();
    }

    /**
     * Refresh the data for all datasets.
     */
    async _refresh() {
        this.refresh_task_queue.enqueue(async () => {
            for (const dataset_id in this.datasets) {
                await this._fetch(dataset_id);
            }
        })
    }

    /**
     * Fetch data for a particular dataset.
     *
     * @param {String} dataset_id The dataset to fetch.
     */
    async _fetch(dataset_id) {
        const params = new URLSearchParams({
            start: new Date(this.start).toISOString(),
            end: new Date(this.end).toISOString(),
        });
        const endpoint = `${DATA_ENDPOINT}/${dataset_id}?${params}`;
        const response = await fetch(endpoint);
        const json = await response.json();
        const data = json.data;
        if (data.dataset === undefined || data.points === undefined) {
            console.log("Invalid response!");
            return;
        }
        this.datasets[dataset_id] = data;
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
         * Redraw the axes.
         */
        this._axes();

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
            if (points.length === 0) {
                continue;
            }

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
         * Redraw the legend.
         */
        this._legend();
    }

    /**
     * Draw the axes.
     */
    _axes() {
        const font_px = 15;
        const margin_px = 10;
        this.graph_ctx.strokeStyle = "#444444";
        this.graph_ctx.fillStyle = "#FFFFFF";
        this.graph_ctx.font = `${font_px}px Arial`;

        /*
         * X axis (date).
         */
        const x_points = 6;
        const x_labels = time_labels(this.start, this.end, x_points);
        for (const x_label of x_labels) {
            const x_px = this.x_scale * (x_label[0] - this.start);
            if (this.settings.show_grid) {
                this.graph_ctx.beginPath();
                this.graph_ctx.moveTo(x_px, this.graph_layer.height);
                this.graph_ctx.lineTo(x_px, 0);
                this.graph_ctx.stroke();
            }

            this.graph_ctx.fillText(`${x_label[1]}`, x_px, this.graph_layer.height - margin_px);
        }

        /*
         * Y axis.
         */
        const y_points = 10;
        const y_labels = base10_labels(this.min_y, this.max_y, y_points);
        for (const y_label of y_labels) {
            const y_px = this.y_scale * (this.max_y - y_label);
            if (this.graph_layer.height - y_px > 2 * margin_px) {
                if (this.settings.show_grid) {
                    this.graph_ctx.beginPath();
                    this.graph_ctx.moveTo(0, y_px);
                    this.graph_ctx.lineTo(this.graph_layer.width, y_px);
                    this.graph_ctx.stroke();
                }

                this.graph_ctx.fillText(`${y_label}`, margin_px, y_px + (font_px / 2));
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

        if (this.settings.mouse_mode == MouseMode.ZOOM) {
            /*
             * If we're dragging in zoom mode, gray out the area outside the zoom range.
             */
            if (this.drag_state.in_progress && this.drag_state.should_zoom(this.settings.min_zoom_threshold)) {
                this.interact_ctx.fillStyle = 'rgba(225,225,225,0.1)';

                if (this.drag_state.axis === "x") {
                    const min_x = Math.min(this.drag_state.x0, this.drag_state.x1);
                    const max_x = Math.max(this.drag_state.x0, this.drag_state.x1);
                    this.interact_ctx.fillRect(0, 0, min_x, height);
                    this.interact_ctx.fillRect(max_x, 0, width - max_x, height);
                } else if (this.drag_state.axis === "y") {
                    const min_y = Math.min(this.drag_state.y0, this.drag_state.y1);
                    const max_y = Math.max(this.drag_state.y0, this.drag_state.y1);
                    this.interact_ctx.fillRect(0, 0, width, min_y);
                    this.interact_ctx.fillRect(0, max_y, width, height - max_y);
                }
            }
        } else if (this.settings.mouse_mode == MouseMode.PAN) {
            /*
             * If we're dragging in pan mode, gray out the window slightly
             */
            if (this.drag_state.in_progress) {
                this.interact_ctx.fillStyle = 'rgba(225,225,225,0.05)';
                this.interact_ctx.fillRect(0, 0, width, height);
            }
        }
    }

    /**
     * Redraw the toolbar.
     */
    _toolbar() {
        if (this.settings.show_points) {
            this.toolbar_point_toggle.classList.add("btn-enabled");
        } else {
            this.toolbar_point_toggle.classList.remove("btn-enabled");
        }

        if (this.settings.show_grid) {
            this.toolbar_grid_toggle.classList.add("btn-enabled");
        } else {
            this.toolbar_grid_toggle.classList.remove("btn-enabled");
        }

        if (this.settings.mouse_mode == MouseMode.ZOOM) {
            this.toolbar_mouse_zoom.classList.add("btn-enabled");
            this.toolbar_mouse_pan.classList.remove("btn-enabled");
        } else {
            this.toolbar_mouse_zoom.classList.remove("btn-enabled");
            this.toolbar_mouse_pan.classList.add("btn-enabled");
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
     * Handle a mouse down event.
     *
     * @param {*} event
     */
    _mouse_down(event) {
        this.drag_state.mouse_down(event.offsetX, event.offsetY);
    }

    /**
     * Handle a mouse move event.
     *
     * @param {*} event
     */
    _mouse_move(event) {
        if (!this.drag_state.in_progress) {
            return;
        }

        this.drag_state.mouse_drag(event.offsetX, event.offsetY);
        this._interact_layer();

        if (this.settings.mouse_mode == MouseMode.PAN) {
            this._pan_move(event, false);
        }
    }

    /**
     * Handle a mouse up event.
     *
     * @param {*} event
     */
    _mouse_up(event) {
        if (!this.drag_state.in_progress) {
            return;
        }

        this.drag_state.mouse_up(event.offsetX, event.offsetY);
        this._interact_layer();

        if (this.settings.mouse_mode == MouseMode.ZOOM) {
            this._zoom_end();
        } else if (this.settings.mouse_mode == MouseMode.PAN) {
            this._pan_move(event, true);
        }
    }

    /**
     * Handle a mouse leave event.
     *
     * @param {*} event
     */
    _mouse_leave() {
        this.drag_state.cancel();
        this._interact_layer();
    }

    /**
     * Handle the end of a zoom event.
     */
    _zoom_end() {
        if (!this.drag_state.should_zoom(this.settings.min_zoom_threshold)) {
            return;
        }

        /*
         * Set the new x axis bounds.
         */
        if (this.drag_state.axis === "x") {
            const x_range = this.end - this.start;
            if (x_range < 5) {
                return;
            }

            const x0 = Math.min(this.drag_state.x0, this.drag_state.x1);
            const x1 = Math.max(this.drag_state.x0, this.drag_state.x1);

            this.end = this.start + (x1 / this.x_scale);
            this.start = this.start + (x0 / this.x_scale);
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
     * Zoom handler for the mousewheel.
     *
     * The desired behavior in a mousewheel zoom is that the x coordinate at the cursor
     * remains constant, while the range zooms out by some factor.
     *
     * @param {*} event
     */
    _zoom_mousewheel(event) {
        if (this.drag_state.axis === "y") {
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
        if (this.drag_state.axis === "y") {
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
        if (this.drag_state.axis === "y") {
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
        if (this.end - this.start < 5 && zoom_factor < 0) {
            return;
        }

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

    /*
     * Handle interactive pan
     */

    /**
     * Handle the panning of the window on mouse move.
     *
     * @param {*} event
     * @param {boolean} refresh Whether to refresh data at the backend.
     *
     * @returns
     */
    _pan_move(event, refresh) {
        /*
         * Set the new x axis bounds.
         */
        if (this.drag_state.axis === "x") {
            const pan_dist = -this.drag_state.dx / this.x_scale;
            this.start += pan_dist;
            this.end += pan_dist;
        } else {
            /*
             * TODO y axis pan.
             */
        }

        /*
         * Draw the graph immediately for instant gratificaiton.
         */
        this._graph_layer();
        if (refresh)
        {
            this._refresh();
        }
    }

    /**
     * Toggle the show_points config.
     */
    _toggle_points() {
        this.settings.show_points = !this.settings.show_points;
        this._toolbar();
        this._graph_layer();
    }

    /**
     * Toggle the show_grid config.
     */
    _toggle_grid() {
        this.settings.show_grid = !this.settings.show_grid;
        this._toolbar();
        this._graph_layer();
    }

    /**
     * Toggle the mouse mode to zoom.
     */
    _set_mouse_mode(mouse_mode) {
        this.settings.mouse_mode = mouse_mode;
        this._toolbar();
    }
}

/**
 * Enum for mouse modes.
 */
class MouseMode {
    static ZOOM = "zoom";
    static PAN = "pan";
}

/**
 * Class which tracks the state of a drag event.
 */
class DragState {
    /**
     * Constructor.
     */
    constructor() {
        this.in_progress = false;
        this.axis = "x";
        this.x0 = -1;
        this.y0 = -1;
        this.x1 = -1;
        this.y1 = -1;
        this.dx = 0;
        this.dy = 0;
    }

    mouse_down(x, y) {
        this.in_progress = true;
        this.x0 = x;
        this.y0 = y;
        this.x1 = x;
        this.y1 = y;
    }

    mouse_drag(x, y) {
        this.dx = x - this.x1;
        this.dy = y - this.y1;
        this.x1 = x;
        this.y1 = y;
    }

    mouse_up(x, y) {
        this.in_progress = false;
        this.dx = x - this.x1;
        this.dy = y - this.y1;
        this.x1 = x;
        this.y1 = y;
    }

    cancel() {
        this.in_progress = false;
    }

    should_zoom(threshold) {
        if (this.axis == "x") {
            return Math.abs(this.x1 - this.x0) > threshold;
        }
        if (this.axis == "y") {
            return Math.abs(this.y1 - this.y0) > threshold;
        }
    }
}
