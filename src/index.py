"""
The backbone data index.
"""

from dataclasses import dataclass
from datetime import datetime
import itertools
import pathlib
import re
from typing import Generator

from src.model.data import AggregatedDatapoint, Datapoint
from src.model.fidelity import Fidelity

# The index looks like this:
#
# Each aggregation level aggregates all datapoints for a time period (i.e. 10s) and
# stores that record as a line in a file. We adjust the constants to target 5000
# lines in each file. Using the 10s aggregation level as an example, we'd expect to
# have a single file with 5000 10s aggregation records covering a ~14 hour timespan.
#
# The directory hierarchy at the top level looks something like this:
#    data/<fidelity>/<dataset_id>/<#>/<#>/<#>/<timestamp>
#       - fidelity is the fidelity of the data (i.e., "10", or "full")
#       - dataset_id is the datapoint name
#       - <#> is a number derived from the timestamp. Directories are organized such
#           that there are 20 and 200 files at each level.
#       - The name of the actual file with the data is the timestamp divided by the
#           window of time that file covers.
#
# When new data is inserted, it is automatically indexed at all fidelity levels. In
# theory, each level of fidelity divides the number of datapoints by 10 so each layer
# is progressively faster to store.
#
# TODO / current limitations:
#       - Sparse Data: This system doesn't scale super well if you have a million
#           records all spaced apart by 15 minutes. That will create a million files
#           at the 1s interval. This is solveable with some tradeoffs.
#       - Duplicate Data: It's pretty easy to detect this but not a super common
#           problem in practice.
#       - Aggregation Timestamp: The aggregation timestamp (in the data) doesn't match
#           any particular point. This is actually by design but could be misleading or
#           confusing. WONTFIX :-)

# The maximum number of datapoints present in a single file.
DATAPOINT_GROUP_SIZE = 5000

# The constants below describe the duration for which the respective fidelity will
# yield DATAPOINT_GROUP_SIZE. Full duration is tuned for 10Hz. Faster or slower
# telemetry rates may not perform as well.
MAX_DURATION_FULL = DATAPOINT_GROUP_SIZE / 10
MAX_DURATION_1 = DATAPOINT_GROUP_SIZE
MAX_DURATION_10 = MAX_DURATION_1 * 10
MAX_DURATION_100 = MAX_DURATION_1 * 100
MAX_DURATION_1000 = MAX_DURATION_1 * 1000
MAX_DURATION_10000 = MAX_DURATION_1 * 10000
MAX_DURATION_100000 = MAX_DURATION_1 * 100000

# Legal values for a dataset_id.
LEGAL_DATASET_CHARS = re.compile(r"[a-zA-Z0-9\._\-]+")


@dataclass
class _Datapoint:
    timestamp: float
    value: float


@dataclass
class _AggregatedDatapoint:
    timestamp: int
    min_value: float
    max_value: float
    sum_values: float
    count: int


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
        self.num_puts = 0
        self.num_gets = 0

        self._init_backing_store()

    def put(self, dataset_id: str, points: list[Datapoint]):
        """
        Push some data.

        Args:
            dataset_id: The ID of the dataset.
            points: The points to insert.
        """
        self.num_puts += 1

        if not LEGAL_DATASET_CHARS.fullmatch(dataset_id) or ".." in dataset_id:
            raise ValueError(
                f'Illegal dataset ID. Must match "{LEGAL_DATASET_CHARS}" and not include ".."'
            )

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

        Returns: A list of datapoints covering this window, possible aggregated.
        """
        self.num_gets += 1

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

    def datasets(self, query: str, max_count: int = 300) -> list[str]:
        """
        Get a list of all datasets this index currently knows about that match the
        provided query.

        Args:
            query: A query string.
            max_count: The maximum number of results to return.

        Returns:
            A list of all dataset_ids represented by this index.
        """
        path = self.base / "full"
        if not path.is_dir():
            return []

        return [
            f.name
            for f in itertools.islice(path.iterdir(), max_count)
            if query in f.name
        ]

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
        Given a list of points, emit one aggregated point for each duration interval.

        Args:
            points: A list of datapoints.
            duration: The aggregation duration in seconds.

        Returns: The aggregated datapoints.
        """
        if len(points) == 0:
            return []

        aggregated = []
        bin_id = None
        window = []
        for point in points:
            # Determine which bin the point falls into by truncating to the nearest duration.
            cur_bin_id = int(int(point.timestamp / duration) * duration)
            if cur_bin_id != bin_id and bin_id is not None:
                # Bin the previous window.
                agg = _AggregatedDatapoint(
                    timestamp=bin_id,
                    min_value=min(window),
                    max_value=max(window),
                    sum_values=sum(window),
                    count=len(window),
                )
                aggregated.append(agg)

                # Clear the window.
                window = []

            bin_id = cur_bin_id
            window.append(point.value)

        # Bin the last datapoint.
        agg = _AggregatedDatapoint(
            timestamp=bin_id,
            min_value=min(window),
            max_value=max(window),
            sum_values=sum(window),
            count=len(window),
        )
        aggregated.append(agg)
        return aggregated

    @staticmethod
    def _combine_aggregations(
        points1: list[_AggregatedDatapoint],
        points2: list[_AggregatedDatapoint],
    ) -> list[_AggregatedDatapoint]:
        """
        Given two lists of aggregated datapoints, merge overlapping aggregations.

        The algorithm assumes the two lists of points are sorted by timestamp.

        Args:
            points1: The first set of aggregated datapoints.
            points2: The second set of aggregated datapoints.

        Returns: The combined aggregated datapoints, in time order.
        """
        aggregated = []
        i = 0
        j = 0
        while i < len(points1) and j < len(points2):
            point1 = points1[i]
            point2 = points2[j]
            if point1.timestamp < point2.timestamp:
                aggregated.append(point1)
                i += 1
            elif point1.timestamp > point2.timestamp:
                aggregated.append(point2)
                j += 1
            else:
                aggregated.append(
                    _AggregatedDatapoint(
                        timestamp=point1.timestamp,
                        min_value=min(point1.min_value, point2.min_value),
                        max_value=max(point1.max_value, point2.max_value),
                        sum_values=point1.sum_values + point2.sum_values,
                        count=point1.count + point2.count,
                    )
                )
                i += 1
                j += 1
        while i < len(points1):
            aggregated.append(points1[i])
            i += 1
        while j < len(points2):
            aggregated.append(points2[j])
            j += 1
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

        # Get the list of points that have already been indexed at this path and
        # combine them with the new points we're about to add.
        existing_points = list(Index._raw_agg_datapoints(path))
        combined_points = Index._combine_aggregations(existing_points, datapoints)

        with open(path, "w") as f:
            for datapoint in combined_points:
                f.write(
                    "{},{},{},{},{}\n".format(
                        datapoint.timestamp,
                        datapoint.min_value,
                        datapoint.max_value,
                        datapoint.sum_values,
                        datapoint.count,
                    )
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
    def _read_agg_datapoints(path: pathlib.Path) -> list[AggregatedDatapoint]:
        """
        Read all of the datapoints in a file. The returned datapoints are not guaranteed
        to be in order. If the path doesn't exist, an empty set of datapoints is returned.

        Args:
            path: The path to read from.
        """
        datapoints = []
        for datapoint in Index._raw_agg_datapoints(path):
            datestr = datetime.fromtimestamp(datapoint.timestamp).isoformat()
            datapoints.append(
                AggregatedDatapoint(
                    datestr,
                    datapoint.min_value,
                    datapoint.sum_values / datapoint.count,
                    datapoint.max_value,
                )
            )
        return datapoints

    @staticmethod
    def _raw_agg_datapoints(
        path: pathlib.Path,
    ) -> Generator[_AggregatedDatapoint, None, None]:
        """
        Generator to get all of the datapoints in a file. Does not convert to the public
        API.

        Args:
            path: The path to read from.
        """
        if not path.is_file():
            return

        with open(path, "r") as f:
            for line in f.readlines():
                timestamp, min, max, sum, count = line.split(",")
                yield _AggregatedDatapoint(
                    timestamp=int(timestamp),
                    min_value=float(min),
                    max_value=float(max),
                    sum_values=float(sum),
                    count=int(count),
                )
