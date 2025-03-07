/**
 * Module which controls the control flow for the comment interface.
 */

const COMMENT_ENDPOINT = "/api/comment";

/**
 * Get the comments in this provided time range.
 *
 * @param {Number} start The start time range.
 * @param {Number} end The end time range.
 */
export async function get_comments(start, end) {
    const params = new URLSearchParams({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
    });
    const endpoint = `${COMMENT_ENDPOINT}?${params}`;
    const response = await fetch(endpoint);
    if (response.ok) {
        const json = await response.json();
        return json.comments;
    } else {
        return [];
    }
}

export class CommentCreateController {
    constructor() {
        this.active = false;
        this.time = undefined;
        this.comment_form = document.getElementById("comment-form");
        this.comment_date = document.getElementById("comment-date");
        this.comment_text = document.getElementById("comment-text");
        this.cancel_button = document.getElementById("comment-button-cancel");
        this.submit_button = document.getElementById("comment-button-submit");
        this.comment_form.style.visibility = "hidden";

        /*
         * Register handlers.
         */
        this.cancel_button.onclick = (event) => this.cancel();
        this.submit_button.onclick = (event) => this.submit();

        this.on_submit = () => {};
    }

    /**
     * Start a new comment create workflow. The x,y coordinates are for the
     * bottom left corner of the form.
     *
     * @param {Date} time The initial timestamp of the new comment.
     * @param {Number} x_pos The x pixel to place the form (from left).
     * @param {Number} y_pos The y pixel to place the form (from top).
     */
    start_create(time, x_pos, y_pos) {
        this.active = true;
        this.time = time;

        const y_pos_adj = y_pos - this.comment_form.offsetHeight;

        this.comment_form.style.visibility = "visible";
        this.comment_form.style.left = `${x_pos}px`;
        this.comment_form.style.top = `${y_pos_adj}px`;
        this.comment_form.classList.remove("border-warning");

        this.comment_date.value = new Date(this.time).toISOString();
    }

    /**
     * Move the form to a new x,y position. This might be called if the window
     * is rescaled, for instance.
     *
     * @param {*} x_pos The x pixel to place the form (from left).
     * @param {*} y_pos The y pixel to place the form (from top).
     */
    move(x_pos, y_pos) {
        if (this.active) {
            const y_pos_adj = y_pos - this.comment_form.offsetHeight;
            this.comment_form.style.left = `${x_pos}px`;
            this.comment_form.style.top = `${y_pos_adj}px`;
        }
    }

    /**
     * Submit handler.
     */
    async submit() {
        const success = await this._post(this.comment_date.value, this.comment_text.value, []);
        if (success) {
            this.cancel();
            this.on_submit();
        } else {
            this.comment_form.classList.add("border-warning");
        }
    }

    /**
     * Cancel handler.
     */
    cancel() {
        this.active = false;
        this.time = undefined;
        this.comment_date.value = "";
        this.comment_text.value = "";
        this.comment_form.style.visibility = "hidden";
        this.comment_form.classList.remove("border-warning");
    }

    /**
     * Post a Comment to the API.
     *
     * @param {string} date The date
     * @param {string} text The text of the comment
     * @param {Array<string>} tags The list of tags
     */
    async _post(date, text, tags) {
        const url = `${COMMENT_ENDPOINT}/new`
        const body = {
            comment: {
                id: 0,
                date: date,
                text: text,
                tags: tags,
            }
        }
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        console.log(response);
        return response.ok;
    }
}