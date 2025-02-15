"""
Script which monitors a set of files and posts to the telemetry API at some rate.
"""

import argparse
import asyncio
from datetime import datetime
import pathlib
import requests
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="monitor_files.py",
        description="Monitor some local files and post to the telemetry API",
    )
    parser.add_argument(
        "--host",
        default="localhost:8080",
        help="The API endpoint",
    )
    parser.add_argument(
        "--capture_period",
        default=0.1,
        type=float,
        help="The period at which to capture data, in seconds",
    )
    parser.add_argument(
        "--post_period",
        default=2.0,
        type=float,
        help="The period at which to post data, in seconds",
    )
    parser.add_argument(
        "files",
        nargs="+",
        help="A list of files to monitor in the format <name>:<path>",
    )
    return parser.parse_args()


def go(args: argparse.Namespace):
    url = f"http://{args.host}/api/data"

    # Maps a dataset_id to a list of datapoints
    data: dict[str, list[tuple[datetime, float]]] = {}

    # poll telemetry for a particular dataset.
    async def poll(dataset_id: str, path: pathlib.Path, period: float):
        while True:
            text = path.read_text()
            data[dataset_id].append((datetime.now(), float(text)))
            await asyncio.sleep(period)

    # Post telemetry.
    async def post(period: float):
        while True:
            await asyncio.sleep(period)
            req = []
            for dataset_id in data.keys():
                # This doesn't have to be threadsafe
                points = data[dataset_id]
                data[dataset_id] = []

                req.append(
                    {
                        "dataset_id": dataset_id,
                        "points": [
                            {
                                "date": date.isoformat(),
                                "value": value,
                            }
                            for date, value in points
                        ],
                    }
                )

            print(req)
            resp = requests.post(url, json={"data": req})
            print(resp)

    # Queue a bunch of async tasks to poll the files.
    futures = []
    for file in args.files:
        try:
            dataset_id, path = file.split(":", maxsplit=1)
        except ValueError:
            print(f"Paths must look like: '<data_name>:<path>' Got: '{file}'")
            sys.exit(1)
        data[dataset_id] = []
        futures.append(poll(dataset_id, pathlib.Path(path), args.capture_period))
    futures.append(post(args.post_period))

    eloop = asyncio.get_event_loop()
    future = asyncio.gather(*futures)
    eloop.run_until_complete(future)


args = parse_args()
go(args)
