
/**
 * A div whose right border is resizable.
 */
export class ResizableDiv {
    /**
     * Constructor.
     *
     * @param {*} container_id The HTML id of the container to resize.
     * @param {*} handle_id The HTML id of the draggable handle.
     * @param {*} onresize Optional callback for when the div has been resized.
     */
    constructor(container_id, handle_id, onresize) {
        this.container = document.getElementById(container_id);

        this.handle = document.getElementById(handle_id);
        this.handle.draggable = true;
        this.handle.addEventListener("dragstart", event => this._drag_start(event));
        this.handle.addEventListener("drag", event => this._drag(event));
        this.handle.addEventListener("dragend", event => this._drag_end(event));

        this.onresize = onresize;

        this.x = -1;

    }

    _drag_start(event) {
        this.x = event.pageX;
    }

    _drag(event) {
        const new_width = this.container.clientWidth + event.pageX - this.x;
        this.container.style.width = `${new_width}px`;
        this.x = event.pageX;
    }

    _drag_end(event) {
        event.preventDefault();
        this.onresize();
    }
}