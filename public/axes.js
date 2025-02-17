/**
 * Calculates the best y axis labels for a particular resolution.
 *
 * @param {Number} min_y The minimum y value.
 * @param {Number} max_y The maximum y value.
 * @param {Number} max_labels The max number of labels that will fit on the axis.
 *
 * @returns {Array<Number>} The axis labels
 */
export function ylabels(min_y, max_y, max_labels) {
    const y_range = max_y - min_y;

    /*
     * Calculate the spacing between elements needed to hit this target.
     */
    var spacing = y_range / (max_labels + 1);

    /*
     * Adjust spacing down to between [0.1, 1].
     */
    var scale_factor = 10 ** Math.floor(Math.log10(spacing));
    var adj_spacing = spacing / scale_factor;

    /*
     * Adjust up the spacing to hit an even multiple of 1 / 2 / 2.5 / 5 / 10
     */
    if (adj_spacing < 2) {
        adj_spacing = 2;
    } else if (adj_spacing < 2.5) {
        adj_spacing = 2.5;
    } else if (adj_spacing < 5) {
        adj_spacing = 5;
    } else {
        adj_spacing = 10.0;
    }

    /*
     * Adjust that spacing back up in to the range of the original values.
     */
    spacing = adj_spacing * scale_factor;

    /*
     * Add all of the points.
     */
    const first = Math.ceil(min_y / spacing) * spacing;
    let labels = [];
    for (let i = 0; i < max_labels; ++i) {
        let point = first + spacing * i;
        if (point >= max_y) {
            break;
        }
        labels.push(Number(point.toFixed(2)));
    }

    return labels;
}