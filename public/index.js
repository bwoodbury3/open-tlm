import { Graph } from "/public/graph.js";
import { SearchBar } from "/public/search.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

var graph = null;
var search_bar = null;

window.addEventListener('load', function () {
    /*
     * Create the Graph controller
     */
    const graph_layer = document.getElementById("layer-graph");
    const interact_layer = document.getElementById("layer-interact");
    const legend = document.getElementById("legend");
    const date_start = new Date();
    const date_end = new Date();
    date_start.setTime(date_start.getTime() - 365 * 10 * MS_PER_DAY);
    graph = new Graph(graph_layer, interact_layer, legend, date_start, date_end, []);

    /*
     * Create the SearchBar controller.
     */
    const search_input = document.getElementById("dataset-search-input");
    const search_results = document.getElementById("dataset-search-results");
    search_bar = new SearchBar(search_input, search_results, (dataset_id) => {
        graph.add_dataset(dataset_id);
    });
});
