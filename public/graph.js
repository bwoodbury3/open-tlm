import { XAxis, YAxis } from "/public/axes.js";
import { ColorPicker } from "/public/color.js";
import { TaskQueue } from "/public/tasks.js";

const DATA_ENDPOINT = "/api/data";

/*
 * TODO:
 *
 * UX improvements
 *      - Multiple axes
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
        this.x_axis = new XAxis();
        this.y_axes = [new YAxis(), new YAxis()];
        this.colors = {};

        this.settings = {
            mouse_mode: MouseMode.ZOOM,
            show_grid: true,
            grid_axis: 0,
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
         * Initialize the datetime picker.
         */
        this.start_datetime = document.getElementById("start-datetime");
        this.end_datetime = document.getElementById("end-datetime");
        this.start_datetime.addEventListener("focusout", event => this._on_datetime_change());
        this.end_datetime.addEventListener("focusout", event => this._on_datetime_change());

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
        for (const y_axis of this.y_axes) {
            if (y_axis.has(dataset_id)) {
                return;
            }
        }

        this._graph_layer();
        this._fetch(dataset_id, 0);
    }

    /**
     * Remove a dataset ID from the graph.
     *
     * @param {String} dataset_id The dataset ID.
     */
    remove_dataset(dataset_id) {
        for (const y_axis of this.y_axes) {
            if (y_axis.has(dataset_id)) {
                y_axis.remove_dataset(dataset_id);
            }
        }

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
            for (const axis_index in this.y_axes) {
                for (const dataset_id in this.y_axes[axis_index].datasets) {
                    await this._fetch(dataset_id, axis_index);
                }
            }
        })
    }

    /**
     * Fetch data for a particular dataset.
     *
     * @param {String} dataset_id The dataset to fetch.
     * @param {Number} axis_index The axis index.
     */
    async _fetch(dataset_id, axis_index) {
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
        this.y_axes[axis_index].add_dataset(dataset_id, data);
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
         * Re-scale the axes.
         */
        this.x_axis.resize(this.start, this.end, this.graph_layer.width);
        for (const y_axis of this.y_axes) {
            y_axis.resize(this.graph_layer.height);
        }

        /*
         * Calculate all of the pixelpoints.
         */
        this.pixelpoints = {};
        for (const y_axis of this.y_axes) {
            Object.assign(this.pixelpoints, y_axis.get_pixelpoints(this.x_axis));
        }

        /*
         * Redraw the axes.
         */
        this._axes();

        /*
         * Update the datetime input fields.
         */
        this._update_datetime();

        /*
         * Pick all of the colors.
         */
        for (const y_axis of this.y_axes) {
            for (const dataset_id in y_axis.datasets) {
                if (!(dataset_id in this.colors)) {
                    this.colors[dataset_id] = this.color_picker.next();
                }
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
        const y_max_width = font_px * 5;
        this.graph_ctx.strokeStyle = "#444444";
        this.graph_ctx.fillStyle = "#FFFFFF";
        this.graph_ctx.font = `${font_px}px Arial`;

        /*
         * X axis (date).
         */
        const x_points = 6;
        const x_labels = this.x_axis.labels(x_points);
        for (const x_label of x_labels) {
            const x_px = this.x_axis.scale * (x_label[0] - this.start);

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
        const x_pos = {
            0: margin_px,
            1: this.graph_layer.width - y_max_width - margin_px,
        };

        for (const axis_index in this.y_axes) {
            const y_axis = this.y_axes[axis_index];
            const y_labels = y_axis.labels(y_points);
            const grid_enabled =
                this.settings.show_grid &&
                this.settings.grid_axis == axis_index;

            /*
             * Only draw the axis labels if there is data on this axis.
             */
            if (y_axis.length() === 0) {
                continue;
            }

            for (const y_label of y_labels) {
                const y_px = y_axis.scale * (y_axis.max_y - y_label);

                if (this.graph_layer.height - y_px > 2 * margin_px) {
                    /*
                     * Draw the grid if it's enabled.
                     */
                    if (grid_enabled) {
                        this.graph_ctx.beginPath();
                        this.graph_ctx.moveTo(0, y_px);
                        this.graph_ctx.lineTo(this.graph_layer.width, y_px);
                        this.graph_ctx.stroke();
                    }

                    /*
                     * Draw the axis label.
                     */
                    var formatted = `${y_label}`;
                    if (y_label < 0.001 || y_label > 100000) {
                        formatted = y_label.toExponential(3);
                    }
                    this.graph_ctx.fillText(
                        formatted,
                        x_pos[axis_index],
                        y_px + (font_px / 2)
                    );
                }
            }
        }
    }

    /**
     * Draw the legend.
     */
    _legend() {
        /*
         * Show or hide the legend.
         */
        var any_data = false;
        for (const y_axis of this.y_axes) {
            if (y_axis.length() > 0) {
                any_data = true;
                break;
            }
        }
        this.legend.style.visibility = any_data ? "visible" : "hidden";

        /*
         * Render all of the datasets in the legend.
         */
        var legend_html = `<table class="legend">`;
        for (const axis_index in this.y_axes) {
            const y_axis = this.y_axes[axis_index];
            for (const dataset_id in y_axis.datasets) {
                const axis_indicator = axis_index == 0 ? "<" : ">";
                legend_html += `
                    <tr>
                        <td class="text-secondary clickable" id="axis-toggle-${dataset_id}">
                            <span title="Toggle vertical axis">
                                ${axis_indicator}
                            </span>
                        </td>
                        <td>
                            <p id="legend-${dataset_id}"
                                class="clickable mb-0"
                                style="color: ${this.colors[dataset_id]}">
                                ${dataset_id}
                            </p>
                        </td>
                    </tr>
                `;
            }
        }
        legend_html += "</table>";
        this.legend.innerHTML = legend_html;

        /*
         * Render the handlers.
         */
        for (const axis of this.y_axes) {
            for (const dataset_id in axis.datasets) {
                const legend_item = document.getElementById(`legend-${dataset_id}`);
                legend_item.onclick = () => this.remove_dataset(dataset_id);
                const axis_toggle = document.getElementById(`axis-toggle-${dataset_id}`);
                axis_toggle.onclick = () => this._toggle_axis(dataset_id);
            }
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
        /*
         * Refuse to render the tooltip if we're dragging/zooming something.
         */
        if (this.drag_state.in_progress) {
            return;
        }

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
        for (const y_axis of this.y_axes) {
            for (const dataset_id of Object.keys(y_axis.datasets).reverse()) {
                const points = this.pixelpoints[dataset_id];
                for (const i in points) {
                    const point = points[i];
                    if (Math.abs(mouse_x - point[0]) <= point_width &&
                            Math.abs(mouse_y - point[1]) <= point_width) {
                        active = true;
                        pixelpoint = point;
                        datapoint = y_axis.datasets[dataset_id].points[i];
                        dataset = dataset_id;
                        break;
                    }
                }

                if (active) {
                    break;
                }
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

            this.end = this.start + (x1 / this.x_axis.scale);
            this.start = this.start + (x0 / this.x_axis.scale);
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
            const pan_dist = -this.drag_state.dx / this.x_axis.scale;
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

    /**
     * Update the start/end time fields and any necessary error handling.
     */
    _update_datetime() {
        this.start_datetime.value = new Date(this.start).toISOString();
        this.end_datetime.value = new Date(this.end).toISOString();

        if (this.start >= this.end) {
            this.start_datetime.classList.add("input-invalid");
            this.end_datetime.classList.add("input-invalid");
        } else {
            this.start_datetime.classList.remove("input-invalid");
            this.end_datetime.classList.remove("input-invalid");
        }
    }

    /**
     * Callback for when the datetime input field has changed.
     */
    _on_datetime_change() {
        const start_input = new Date(this.start_datetime.value).getTime();
        const end_input = new Date(this.end_datetime.value).getTime();
        if (start_input >= end_input) {
            this.start_datetime.classList.add("input-invalid");
            this.end_datetime.classList.add("input-invalid");
        } else {
            this.start_datetime.classList.remove("input-invalid");
            this.end_datetime.classList.remove("input-invalid");
            this.start = start_input;
            this.end = end_input;

            this._graph_layer();
            this._refresh();
        }
    }

    /**
     * Toggle the axis for a dataset.
     *
     * @param {String} dataset_id
     */
    _toggle_axis(dataset_id) {
        if (this.y_axes[0].has(dataset_id)) {
            const data = this.y_axes[0].remove_dataset(dataset_id);
            this.y_axes[1].add_dataset(dataset_id, data);
        } else {
            const data = this.y_axes[1].remove_dataset(dataset_id);
            this.y_axes[0].add_dataset(dataset_id, data);
        }

        /*
         * Redraw the graph. Shouldn't need to fetch new data here.
         */
        this._graph_layer();
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
