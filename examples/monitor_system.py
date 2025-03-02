"""
Script which monitors system resources.
"""

import argparse
import asyncio
from datetime import datetime
import psutil
import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="monitor_system.py",
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
    return parser.parse_args()


def go(args: argparse.Namespace):
    url = f"http://{args.host}/api/data"

    # Maps a dataset_id to a list of datapoints
    data: dict[str, list[tuple[str, float]]] = {}

    # poll system telemetry.
    async def poll(period: float):
        data["system.cpu.percent"] = []
        data["system.mem.virt.total"] = []
        data["system.mem.virt.avail"] = []
        data["system.mem.virt.percent"] = []
        data["system.batt.percent"] = []
        while True:
            now = datetime.now().isoformat()
            cpu_percent = psutil.cpu_percent()
            mem_vert = psutil.virtual_memory()
            battery = psutil.sensors_battery()

            data["system.cpu.percent"].append((now, cpu_percent))
            data["system.mem.virt.total"].append((now, mem_vert.total))
            data["system.mem.virt.avail"].append((now, mem_vert.available))
            data["system.mem.virt.percent"].append((now, mem_vert.percent))
            data["system.batt.percent"].append((now, battery.percent))
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
                                "date": date,
                                "value": value,
                            }
                            for date, value in points
                        ],
                    }
                )

            resp = requests.post(url, json={"data": req})
            print(resp)

    # Queue a bunch of async tasks to poll the files.
    futures = []
    futures.append(poll(args.capture_period))
    futures.append(post(args.post_period))

    eloop = asyncio.get_event_loop()
    future = asyncio.gather(*futures)
    eloop.run_until_complete(future)


args = parse_args()
go(args)
