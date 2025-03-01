import argparse
from datetime import datetime
import pathlib

from flask import Flask, render_template, request, send_from_directory

from src.index import Index
from src.metrics import loop
from src.model.data import Datapoint, TimeSeriesDataset


DEFAULT_STORE = pathlib.Path(__file__).parent / "data"
TEMPLATES = pathlib.Path(__file__).parent / "templates"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="The server port",
    )
    parser.add_argument(
        "--store",
        type=pathlib.Path,
        default=DEFAULT_STORE,
        help="Path to the backing store on disk",
    )

    return parser.parse_args()


args = parse_args()

# Init flask
app = Flask(__name__, template_folder=TEMPLATES)
app.config["TEMPLATES_AUTO_RELOAD"] = True

# Init backing index
_index = Index(args.store)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/public/<path:path>")
def public(path):
    return send_from_directory("public", path)


@app.route("/api/datasets")
def get_datasets():
    query = request.args.get("text", "")
    return _index.datasets(query)


@app.route("/api/data/<dataset_id>", methods=["GET"])
def get_data(dataset_id: str):
    try:
        start_dt = datetime.fromisoformat(request.args.get("start"))
        end_dt = datetime.fromisoformat(request.args.get("end"))
    except:
        return {"message": "Invalid or missing start/end times"}, 400

    datapoints = _index.get(dataset_id, start_dt, end_dt)
    data = TimeSeriesDataset(dataset_id, datapoints)
    return {"data": data}


@app.route("/api/data", methods=["POST"])
def post_data():
    body = request.get_json()
    try:
        data = body["data"]
    except Exception as e:
        return {"message": "Missing required 'data' key"}, 400

    if type(data) != list or len(data) == 0:
        return {"message": "'data' must be a nonempty list"}, 400

    for dataset in data:
        if "dataset_id" not in dataset:
            return {"message": "One or more data fields was missing 'dataset_id'"}, 400
        if "points" not in dataset:
            return {"message": "One or more data fields was missing 'points'"}, 400

    count = 0
    for dataset in data:
        dataset_id = str(dataset["dataset_id"])
        points = [Datapoint(**point) for point in dataset["points"]]
        try:
            _index.put(dataset_id, points)
        except Exception as e:
            return {"message": str(e)}, 400
        count += len(points)

    return {"message": f"{count} datapoints were posted"}, 200


if __name__ == "__main__":
    loop.run_in_background(_index)
    app.run(port=args.port)
