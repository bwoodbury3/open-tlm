/**
 * Module which controls the dataset search view.
 */

const DATASETS_ENDPOINT = "/api/datasets";


export class SearchBar {
    /**
     * Controller for a search bar.
     *
     * @param {Element} input_field
     * @param {Element} results_container
     * @param {function(String)} on_select
     */
    constructor(input_field, results_container, on_select) {
        this.input_field = input_field;
        this.results_container = results_container;
        this.on_select = on_select;

        this.input_field.addEventListener("input", () => this._load_datasets());
        this.search_count = 0;
        this.last_search_id = 0;
    }

    /**
     * Callback for rendering the results of a search.
     *
     * @param {Array<Object>} datasets The datasets to render
     * @param {Number} search_id The search ID.
     */
    _render_results(datasets, search_id) {
        /*
         * Don't render an out-of-date search.
         */
        if (search_id < this.last_search_id) {
            return;
        }
        this.last_search_id = search_id;

        /*
         * Render a simple message if there are no results.
         */
        if (datasets.length === 0) {
            this.results_container.innerHTML = `
                <p><i>No results</i></p>
            `;
            return;
        }

        /*
         * Render the results.
         */
        this.results_container.innerHTML = "";
        for (const dataset of datasets) {
            this.results_container.innerHTML += `
                <p id="dataset-${dataset}" class="clickable">${dataset}</p>
            `;
        }

        /*
         * Bind onclick handlers.
         */
        for (const dataset of datasets) {
            const dataset_elem = document.getElementById(`dataset-${dataset}`);
            dataset_elem.onclick = () => this.on_select(dataset);
        }
    }

    /**
     * Callback for loading datasets from the public API.
     */
    _load_datasets() {
        this.search_count++;
        const search_id = this.search_count;

        /*
         * If the search box is empty, don't attempt a search.
         */
        if (this.input_field.value === "") {
            this._render_results([], search_id);
            return;
        }

        /*
         * Search for the keyword.
         */
        const params = new URLSearchParams({
            text: this.input_field.value,
        });
        const endpoint = `${DATASETS_ENDPOINT}?${params}`;
        fetch(endpoint)
            .then(response => response.json())
            .then(response => {
                this._render_results(response, search_id)
            });
    }
}
