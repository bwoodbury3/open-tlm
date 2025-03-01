import asyncio
import datetime
from threading import Thread
from typing import Callable

from src.index import Index
from src.model.data import Datapoint


async def _poll(
    data: dict[str, list[Datapoint]],
    dataset_id: str,
    func: Callable[[], float],
    period: float,
):
    """
    Task which polls func() at some period and appends the value to data.

    Args:
        data: The dict to record the data in.
        dataset_id: The dataset ID.
        func: The polling function. Should take no args and return a float.
        period: The interval to poll in seconds.
    """
    data[dataset_id] = []
    while True:
        t = datetime.datetime.now().isoformat()
        val = func()
        data[dataset_id].append(Datapoint(t, val))
        await asyncio.sleep(period)


async def _post(index: Index, data: dict[str, list[Datapoint]], period: float):
    """
    Task which posts and clears the `data` at the specified period.

    Args:
        index: The index.
        data: Ref to the data dictionary.
        period: The period at which to post to the server.
    """
    while True:
        await asyncio.sleep(period)
        for dataset_id in data.keys():
            # This doesn't have to be threadsafe
            points = data[dataset_id]
            data[dataset_id] = []

            index.put(dataset_id, points)


def _thread_main(index: Index):
    """
    The main background thread.
    """
    data: dict[str, list[Datapoint]] = {}
    futures = []

    futures.append(_poll(data, "index.num_puts", lambda: index.num_puts, 1.0))
    futures.append(_poll(data, "index.num_gets", lambda: index.num_gets, 1.0))
    futures.append(_post(index, data, 10.0))

    eloop = asyncio.new_event_loop()
    asyncio.set_event_loop(eloop)

    future = asyncio.gather(*futures)
    eloop.run_until_complete(future)


def run_in_background(index: Index):
    """
    Gather metrics in the background and post them to the server.

    Args:
        index: The index.
    """
    proc = Thread(target=_thread_main, args=(index,))
    proc.start()
