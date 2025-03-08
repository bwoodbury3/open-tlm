import { Graph } from "/public/graph.js";
import { ResizableDiv } from "/public/resizable.js";
import { SearchBar } from "/public/search.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

var graph = null;
var search_bar = null;

window.addEventListener('load', function () {
    /*
     * Load the URL parameters.
     */
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    var start_param = urlParams.get("start");
    var end_param = urlParams.get("end");
    var axis0_datasets_param = urlParams.get("axis0");
    var axis1_datasets_param = urlParams.get("axis1");

     // Default to the last 24 hrs
    let date_start = new Date(new Date().getTime() - MS_PER_DAY);
    let date_end = new Date();
    if (start_param != null && end_param != null) {
        try {
            const date_start_param = new Date(start_param);
            const date_end_param = new Date(end_param);
            if (date_start_param.getTime() < date_end_param.getTime()) {
                date_start = date_start_param;
                date_end = date_end_param;
            } else {
                alert("Invalid sharelink! start > end");
            }
        } catch (error) {
            console.error("Invalid sharelink:", error.message);
        }
    }

    var axis0_datasets = [];
    var axis1_datasets = [];
    if (axis0_datasets_param != null && axis0_datasets_param !== "") {
        try {
            axis0_datasets = axis0_datasets_param.split(",")
        } catch (error) {
            console.error("Invalid sharelink:", error.message);
        }
    }
    if (axis1_datasets_param != null && axis1_datasets_param !== "") {
        try {
            axis1_datasets = axis1_datasets_param.split(",")
        } catch (error) {
            console.error("Invalid sharelink:", error.message);
        }
    }

    /*
     * Create the Graph controller
     */
    graph = new Graph(date_start, date_end, axis0_datasets, axis1_datasets);

    /*
     * Create the SearchBar controller.
     */
    const search_input = document.getElementById("dataset-search-input");
    const search_results = document.getElementById("dataset-search-results");
    search_bar = new SearchBar(search_input, search_results, (dataset_id) => {
        graph.add_dataset(dataset_id);
    });

    const left_pane = new ResizableDiv("left-pane", "left-pane-drag-handle", () => graph.resize());
});
