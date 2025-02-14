"""
The backbone data index.
"""

from dataclasses import dataclass
from datetime import datetime
import itertools
import pathlib

from src.model.data import AggregatedDatapoint, Datapoint
from src.model.fidelity import Fidelity

# Constants determining data fidelity on query. We approximate a resolution which
# will serve 100-5000 datapoints, which is twice the max number of horizontal pixels
# on a window, beyond which more data does not meaningfully improve the resolution.
#
# Likewise, the backend targets one file per 2000 datapoints
MAX_QUERY_DATAPOINTS = 5000

# The constants below describe the duration for which the respective fidelity will
# yield MAX_QUERY_DATAPOINTS. Full duration is tuned for 10Hz. Faster or slower
# telemetry rates may not perform as well.
MAX_DURATION_FULL = MAX_QUERY_DATAPOINTS / 10
MAX_DURATION_1 = MAX_QUERY_DATAPOINTS
MAX_DURATION_10 = MAX_DURATION_1 * 10
MAX_DURATION_100 = MAX_DURATION_1 * 100
MAX_DURATION_1000 = MAX_DURATION_1 * 1000
MAX_DURATION_10000 = MAX_DURATION_1 * 10000
MAX_DURATION_100000 = MAX_DURATION_1 * 100000

# Internal data storage API


@dataclass
class _Datapoint:
    timestamp: float
    value: float


@dataclass
class _AggregatedDatapoint:
    timestamp: float
    min_value: float
    mean_value: float
    max_value: float


@dataclass
class _GroupedDatapoints:
    timestamp: float
    datapoints: list[_Datapoint | _AggregatedDatapoint]


class Index:
    """
    Class responsible for indexing and retrieving datasets.
    """

    def __init__(self, path: pathlib.Path):
        """
        Constructor.

        Args:
            path: The path on disk where the data is stored.
        """
        self.base = path / "data"

        self._init_backing_store()

    def put(self, dataset_id: str, points: list[Datapoint]):
        """
        Push some data.

        Args:
            dataset_id: The ID of the dataset.
            points: The points to insert.
        """
        if "/" in dataset_id or "." in dataset_id:
            raise ValueError("Dataset ID must not contain slashes")

        # Sort all of the datapoints by UTC timestamp. This makes aggregation/binning cheap.
        _points = [
            _Datapoint(datetime.fromisoformat(point.date).timestamp(), point.value)
            for point in points
        ]
        _points.sort(key=lambda x: x.timestamp)

        # Commit full fidelity data.
        bins = self._bin(_points, MAX_DURATION_FULL)
        for bin in bins:
            path = self._subpath(bin.timestamp, dataset_id, Fidelity.FIDELITY_FULL)
            self._write_datapoints(path, bin.datapoints)

        # TODO: With aggregated fidelity, we need to combine the current datapoints with
        # any datapoints that have been committed in the past. i.e., if a subpath exists,
        # load in that data, and pass _that_ to the aggregator.
        #
        # For now, we will just commit a duplicate aggregated point to the same file with
        # a different value. Good luck frontend on rendering that in a responsible way.

        # 1s fidelity ...
        agg = self._aggregate(_points, 1.0)
        bins = self._bin(agg, MAX_DURATION_1)
        for bin in bins:
            path = self._subpath(bin.timestamp, dataset_id, Fidelity.FIDELITY_1)
            self._write_agg_datapoints(path, bin.datapoints)

        # 10s fidelity ...
        agg = self._aggregate(_points, 10.0)
        bins = self._bin(agg, MAX_DURATION_10)
        for bin in bins:
            path = self._subpath(bin.timestamp, dataset_id, Fidelity.FIDELITY_10)
            self._write_agg_datapoints(path, bin.datapoints)

        # 100s fidelity ...
        agg = self._aggregate(_points, 100.0)
        bins = self._bin(agg, MAX_DURATION_100)
        for bin in bins:
            path = self._subpath(bin.timestamp, dataset_id, Fidelity.FIDELITY_100)
            self._write_agg_datapoints(path, bin.datapoints)

        # 1000s fidelity ...
        agg = self._aggregate(_points, 1000.0)
        bins = self._bin(agg, MAX_DURATION_1000)
        for bin in bins:
            path = self._subpath(bin.timestamp, dataset_id, Fidelity.FIDELITY_1000)
            self._write_agg_datapoints(path, bin.datapoints)

        # 10000s fidelity ...
        agg = self._aggregate(_points, 10000.0)
        bins = self._bin(agg, MAX_DURATION_10000)
        for bin in bins:
            path = self._subpath(bin.timestamp, dataset_id, Fidelity.FIDELITY_10000)
            self._write_agg_datapoints(path, bin.datapoints)

        # 100000s fidelity ...
        agg = self._aggregate(_points, 100000.0)
        bins = self._bin(agg, MAX_DURATION_100000)
        for bin in bins:
            path = self._subpath(bin.timestamp, dataset_id, Fidelity.FIDELITY_100000)
            self._write_agg_datapoints(path, bin.datapoints)

    def get(
        self,
        dataset_id: str,
        start_dt: datetime,
        end_dt: datetime,
        fidelity: Fidelity = None,
    ) -> list[Datapoint | AggregatedDatapoint]:
        """
        Retrieve the data for a dataset at the specified range. The backend should ideally
        choose the correct fidelity based on the time range.

        Args:
            dataset_id: The ID of the dataset.
            start_dt: The start of the query window.
            end_dt: The end of the query window.
            fidelity: The fidelity of the data to return.
        """
        if fidelity is None:
            fidelity = self._recommended_fidelity(start_dt, end_dt)

        # Gather all of the paths which contain the data we care about.
        paths = self._subpaths(start_dt, end_dt, dataset_id, fidelity)

        # Load all of the datapoints from all of the files.
        if fidelity == Fidelity.FIDELITY_FULL:
            return list(
                itertools.chain.from_iterable(
                    self._read_datapoints(path) for path in paths
                )
            )
        return list(
            itertools.chain.from_iterable(
                self._read_agg_datapoints(path) for path in paths
            )
        )

    def _init_backing_store(self):
        """
        Validate and initialize the backing store.
        """
        # Ensure the store is not a regular file.
        if self.base.is_file():
            raise ValueError(f"Backing store must be a directory! Got: {self.base}")

        # Create if not exists.
        self.base.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _recommended_fidelity(start_dt: datetime, end_dt: datetime) -> Fidelity:
        """
        Determine the recommended data fidelity given the start/end time range.

        Args:
            start_dt: The start of the query window.
            end_dt: The end of the query qindow.
        """
        duration_s = end_dt.timestamp() - start_dt.timestamp()
        if duration_s < MAX_DURATION_FULL:
            return Fidelity.FIDELITY_FULL
        elif duration_s < MAX_DURATION_1:
            return Fidelity.FIDELITY_1
        elif duration_s < MAX_DURATION_10:
            return Fidelity.FIDELITY_10
        elif duration_s < MAX_DURATION_100:
            return Fidelity.FIDELITY_100
        elif duration_s < MAX_DURATION_1000:
            return Fidelity.FIDELITY_1000
        elif duration_s < MAX_DURATION_10000:
            return Fidelity.FIDELITY_10000
        else:
            return Fidelity.FIDELITY_100000

    @staticmethod
    def _aggregate(
        points: list[_Datapoint],
        duration: float,
    ) -> list[_AggregatedDatapoint]:
        """
        From a series of points, group all within a specified duration into a single
        AggregatedDatapoint.

        Args:
            points: A list of datapoints.
            duration: The aggregation duration in seconds.

        Returns: The aggregated datapoints.
        """
        aggregated = []
        last_t = None
        window = []
        for point in points:
            # Determine which bin the point falls into by truncating to the nearest duration.
            cur_t = int(int(point.timestamp / duration) * duration)
            if cur_t != last_t and last_t is not None:
                # Bin the previous window.
                agg = _AggregatedDatapoint(
                    timestamp=last_t,
                    min_value=min(window),
                    mean_value=sum(window) / len(window),
                    max_value=max(window),
                )
                aggregated.append(agg)

                # Clear the window.
                window = []
            last_t = cur_t
            window.append(point.value)

        # Bin the last datapoint.
        if last_t is not None:
            agg = _AggregatedDatapoint(
                timestamp=last_t,
                min_value=min(window),
                mean_value=sum(window) / len(window),
                max_value=max(window),
            )
            aggregated.append(agg)
        return aggregated

    @staticmethod
    def _bin(
        points: list[_Datapoint | _AggregatedDatapoint],
        duration: float,
    ) -> list[_GroupedDatapoints]:
        """
        Bin datapoints into buckets of the provided duration.

        Args:
            points: The datapoints to bin.
            duration: The bin duration size.
        """
        bins = []
        last_t = None
        window = []
        for point in points:
            # Determine which bin the point falls into by truncating to the nearest duration.
            cur_t = int(int(point.timestamp / duration) * duration)
            if cur_t != last_t and last_t is not None:
                # Bin the previous window.
                bins.append(_GroupedDatapoints(timestamp=last_t, datapoints=window))

                # Clear the window.
                window = []
            last_t = cur_t
            window.append(point)

        # Bin the last window.
        if last_t is not None:
            bins.append(_GroupedDatapoints(timestamp=last_t, datapoints=window))
        return bins

    def _subpaths(
        self,
        start_dt: datetime,
        end_dt: datetime,
        dataset_id: str,
        fidelity: Fidelity,
        max_steps: float = 500,
    ) -> list[pathlib.Path]:
        """
        Get all of the relevant subpaths.

        Args:
            start_dt: The start date to query.
            end_dt: The start date to query.
            dataset_id: The dataset ID.
            fidelity: The requested fidelity.
            max_steps: Refuse to execute more than this many steps.
        """
        t_start = start_dt.timestamp()
        t_end = end_dt.timestamp()

        paths = []
        if fidelity == Fidelity.FIDELITY_FULL:
            step = MAX_DURATION_FULL
        elif fidelity == Fidelity.FIDELITY_1:
            step = MAX_DURATION_1
        elif fidelity == Fidelity.FIDELITY_10:
            step = MAX_DURATION_10
        elif fidelity == Fidelity.FIDELITY_100:
            step = MAX_DURATION_100
        elif fidelity == Fidelity.FIDELITY_1000:
            step = MAX_DURATION_1000
        elif fidelity == Fidelity.FIDELITY_10000:
            step = MAX_DURATION_10000
        else:
            step = MAX_DURATION_100000

        if (t_end - t_start) / step > max_steps:
            raise ValueError(
                f"Too many steps! start={start_dt}, end={end_dt}, fidelity={fidelity}"
            )

        while True:
            paths.append(self._subpath(t_start, dataset_id, fidelity))

            # We have to process one more step to avoid the case where the last
            # datapoint rounds up to a value higher than t_start.
            if t_start > t_end:
                break
            t_start += step
        return paths

    def _subpath(
        self,
        timestamp: float,
        dataset_id: str,
        fidelity: Fidelity,
    ) -> pathlib.Path:
        """
        Get the subpath for a particular datetime at the provided fidelity.

        Args:
            timestamp: The timestamp to query.
            dataset_id: The dataset ID.
            fidelity: The requested fidelity.
        """
        if timestamp < 0:
            raise ValueError("Data may not be timestamped before the utc epoch")

        # Each layer targets 100 directories.
        a = str(int(timestamp / 10000000))
        b = str(int(timestamp / 100000))
        c = str(int(timestamp / 1000))

        # Target between <200 files at the lowest layer.
        if fidelity == Fidelity.FIDELITY_FULL:
            path = self.base / "full" / dataset_id / a / b / c  # 20 files
            timestamp_trunc = int(timestamp / MAX_DURATION_FULL)
        elif fidelity == Fidelity.FIDELITY_1:
            path = self.base / "1" / dataset_id / a / b  # 200 files
            timestamp_trunc = int(timestamp / MAX_DURATION_1)
        elif fidelity == Fidelity.FIDELITY_10:
            path = self.base / "10" / dataset_id / a / b  # 20 files
            timestamp_trunc = int(timestamp / MAX_DURATION_10)
        elif fidelity == Fidelity.FIDELITY_100:
            path = self.base / "100" / dataset_id / a  # 200 files
            timestamp_trunc = int(timestamp / MAX_DURATION_100)
        elif fidelity == Fidelity.FIDELITY_1000:
            path = self.base / "1000" / dataset_id / a  # 20 files
            timestamp_trunc = int(timestamp / MAX_DURATION_1000)
        elif fidelity == Fidelity.FIDELITY_10000:
            path = self.base / "10000" / dataset_id  # ~30 files
            timestamp_trunc = int(timestamp / MAX_DURATION_10000)
        else:
            path = self.base / "100000" / dataset_id  # ~3 files
            timestamp_trunc = int(timestamp / MAX_DURATION_100000)

        return path / str(timestamp_trunc)

    @staticmethod
    def _write_datapoints(path: pathlib.Path, datapoints: list[_Datapoint]):
        """
        Dump a set of datapoints to the provided path.

        Args:
            path: The path to write to.
            datapoints: The datapoints to dump.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as f:
            for datapoint in datapoints:
                f.write(f"{datapoint.timestamp},{datapoint.value}\n")

    @staticmethod
    def _write_agg_datapoints(
        path: pathlib.Path,
        datapoints: list[_AggregatedDatapoint],
    ):
        """
        Dump a set of aggregated datapoints to the provided path.

        Args:
            path: The path to write to.
            datapoints: The datapoints to dump.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as f:
            for datapoint in datapoints:
                f.write(
                    f"{datapoint.timestamp},{datapoint.min_value},{datapoint.mean_value},{datapoint.max_value}\n"
                )

    @staticmethod
    def _read_datapoints(path: pathlib.Path) -> list[Datapoint]:
        """
        Read all of the datapoints in a file. The returned datapoints are not guaranteed
        to be in order. If the path doesn't exist, an empty set of datapoints is returned.

        Args:
            path: The path to read from.
        """
        datapoints = []
        if not path.is_file():
            return datapoints

        with open(path, "r") as f:
            for line in f.readlines():
                timestamp, value = line.split(",")
                datestr = datetime.fromtimestamp(float(timestamp)).isoformat()
                datapoints.append(Datapoint(datestr, float(value)))
        return datapoints

    @staticmethod
    def _read_agg_datapoints(path: pathlib.Path) -> list[Datapoint]:
        """
        Read all of the datapoints in a file. The returned datapoints are not guaranteed
        to be in order. If the path doesn't exist, an empty set of datapoints is returned.

        Args:
            path: The path to read from.
        """
        datapoints = []
        if not path.is_file():
            return datapoints

        with open(path, "r") as f:
            for line in f.readlines():
                timestamp, min, mean, max = line.split(",")
                datestr = datetime.fromtimestamp(float(timestamp)).isoformat()
                datapoints.append(
                    AggregatedDatapoint(
                        datestr,
                        float(min),
                        float(mean),
                        float(max),
                    )
                )
        return datapoints
