"""
Upload a pre-existing dataset for viewing.
"""

import argparse
from enum import StrEnum
import math
import pandas as pd
import pathlib
import requests


class Format(StrEnum):
    PARQUET = "parquet"

    @classmethod
    def values(cls):
        return list(map(lambda c: c.value, cls))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="upload_data.py",
        description="Upload data stored in other formats",
    )
    parser.add_argument(
        "--host",
        default="localhost:8080",
        help="The API endpoint",
    )
    parser.add_argument(
        "--filename",
        required=True,
        type=str,
        help="The filename with the data",
    )
    parser.add_argument(
        "--format",
        required=True,
        type=str,
        choices=Format.values(),
        help="The incoming data format",
    )
    parser.add_argument(
        "--time-column",
        type=str,
        help="The name of the timestamp column (applies to parquet)",
    )
    parser.add_argument(
        "--prefix",
        type=str,
        default="",
        help="An optional prefix to add to the front of every telemetry name",
    )
    return parser.parse_args()


def load_all(
    filename: pathlib.Path,
    format: str,
    time_column: str,
    prefix: str,
) -> dict[str, list[tuple[str, float]]]:
    if not filename.is_file():
        raise ValueError(f"File not found: {filename}")

    data = {}
    if format == Format.PARQUET.value:
        df = pd.read_parquet(filename)
        time_col = pd.to_datetime(df[time_column]).to_list()
        for label, series in df.items():
            if label == time_column:
                continue

            data[prefix + label] = [
                (time.isoformat(), val)
                for time, val in zip(time_col, series, strict=True)
                if not math.isnan(val)
            ]
    else:
        raise ValueError(
            f"Unknown format: {format}. Please choose one of {Format.values()}"
        )

    return data


def post(args: argparse.Namespace):
    url = f"http://{args.host}/api/data"

    data = load_all(
        pathlib.Path(args.filename), args.format, args.time_column, args.prefix
    )

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
                        "date": date,
                        "value": value,
                    }
                    for date, value in points
                ],
            }
        )

    resp = requests.post(url, json={"data": req})
    print(resp)


args = parse_args()
post(args)
