"""
Unit tests for the indexer/aggregation library.
"""

from datetime import datetime, timedelta
import pathlib
import pytest
from src.model.data import Datapoint
from src.model.fidelity import Fidelity
from src import index
import tempfile


@pytest.fixture
def mktmp():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


def test_put_get(tmpdir: str):
    """
    Simple test of inserting and reading back data.
    """
    tmppath = pathlib.Path(tmpdir)
    _index = index.Index(tmppath)
    dataset_id = "test_put"
    datapoints = [
        Datapoint("2024-01-01T01:00:00", 7.0),
        Datapoint("2024-01-01T01:01:00", 8.0),
        Datapoint("2024-01-01T02:00:00", 9.0),
        Datapoint("2024-01-01T02:30:00", 10.0),
        Datapoint("2024-01-01T02:30:01", 11.5),
        Datapoint("2024-01-01T03:00:00", 10.0),
        Datapoint("2024-01-01T03:00:00.100000", 9.0),
        Datapoint("2024-01-01T03:00:00.200000", 8.0),
        Datapoint("2024-01-01T03:00:00.300000", 7.0),
    ]
    _index.put(dataset_id, datapoints)

    start_dt = datetime.fromisoformat("2024-01-01T00:50:00")
    end_dt = datetime.fromisoformat("2024-01-01T03:30:00")

    # Test full fidelity
    retrieved_points = _index.get(dataset_id, start_dt, end_dt, Fidelity.FIDELITY_FULL)
    assert len(retrieved_points) == 9
    assert set(datapoints) == set(retrieved_points)

    # Test 1s fidelity
    retrieved_points = _index.get(dataset_id, start_dt, end_dt, Fidelity.FIDELITY_1)
    assert len(retrieved_points) == 6
    # The last datapoint should have aggregated the last 4 values.
    last = retrieved_points[-1]
    assert last.min_value == pytest.approx(7.0)
    assert last.max_value == pytest.approx(10.0)
    assert last.mean_value == pytest.approx(8.5)

    # Test 10s fidelity
    retrieved_points = _index.get(dataset_id, start_dt, end_dt, Fidelity.FIDELITY_10)
    assert len(retrieved_points) == 5
    # Test the aggregations
    first = retrieved_points[0]
    assert first.min_value == pytest.approx(7.0)
    assert first.max_value == pytest.approx(7.0)
    assert first.mean_value == pytest.approx(7.0)
    first = retrieved_points[3]
    assert first.min_value == pytest.approx(10.0)
    assert first.max_value == pytest.approx(11.5)
    assert first.mean_value == pytest.approx(10.75)
    last = retrieved_points[4]
    assert last.min_value == pytest.approx(7.0)
    assert last.max_value == pytest.approx(10.0)
    assert last.mean_value == pytest.approx(8.5)

    # Test 100s fidelity
    retrieved_points = _index.get(dataset_id, start_dt, end_dt, Fidelity.FIDELITY_100)
    assert len(retrieved_points) == 4
    # Test the aggregations
    first = retrieved_points[0]
    assert first.min_value == pytest.approx(7.0)
    assert first.max_value == pytest.approx(8.0)
    assert first.mean_value == pytest.approx(7.5)
    first = retrieved_points[2]
    assert first.min_value == pytest.approx(10.0)
    assert first.max_value == pytest.approx(11.5)
    assert first.mean_value == pytest.approx(10.75)
    last = retrieved_points[3]
    assert last.min_value == pytest.approx(7.0)
    assert last.max_value == pytest.approx(10.0)
    assert last.mean_value == pytest.approx(8.5)

    # Test 1000s fidelity
    retrieved_points = _index.get(dataset_id, start_dt, end_dt, Fidelity.FIDELITY_1000)
    assert len(retrieved_points) == 4
    # Test the aggregations
    first = retrieved_points[0]
    assert first.min_value == pytest.approx(7.0)
    assert first.max_value == pytest.approx(8.0)
    assert first.mean_value == pytest.approx(7.5)
    first = retrieved_points[2]
    assert first.min_value == pytest.approx(10.0)
    assert first.max_value == pytest.approx(11.5)
    assert first.mean_value == pytest.approx(10.75)
    last = retrieved_points[3]
    assert last.min_value == pytest.approx(7.0)
    assert last.max_value == pytest.approx(10.0)
    assert last.mean_value == pytest.approx(8.5)

    # Test 10000s fidelity
    retrieved_points = _index.get(dataset_id, start_dt, end_dt, Fidelity.FIDELITY_10000)
    assert len(retrieved_points) == 2
    # Test the aggregations
    first = retrieved_points[0]
    assert first.min_value == pytest.approx(7.0)
    assert first.max_value == pytest.approx(8.0)
    assert first.mean_value == pytest.approx(7.5)
    first = retrieved_points[1]
    assert first.min_value == pytest.approx(7.0)
    assert first.max_value == pytest.approx(11.5)
    assert first.mean_value == pytest.approx(9.214285714285714)

    # Test 100000s fidelity. Hilariously, the time I picked out of a hat just happens
    # to exist on the boundary of a 100000s window, so the aggregation is the same as
    # the above.
    retrieved_points = _index.get(dataset_id, start_dt, end_dt, Fidelity.FIDELITY_10000)
    assert len(retrieved_points) == 2
    # Test the aggregations
    first = retrieved_points[0]
    assert first.min_value == pytest.approx(7.0)
    assert first.max_value == pytest.approx(8.0)
    assert first.mean_value == pytest.approx(7.5)
    first = retrieved_points[1]
    assert first.min_value == pytest.approx(7.0)
    assert first.max_value == pytest.approx(11.5)
    assert first.mean_value == pytest.approx(9.214285714285714)


def test_agg_combine(tmpdir: str):
    """
    Test that data aggregation consolidates successive queries.
    """
    tmppath = pathlib.Path(tmpdir)
    _index = index.Index(tmppath)
    dataset_id = "test_agg_combine"

    # Simulate streaming some 10Hz data in multiple API calls.
    datapoints1 = [
        Datapoint("2024-01-01T03:00:00", 10.0),
        Datapoint("2024-01-01T03:00:00.100000", 9.0),
        Datapoint("2024-01-01T03:00:00.200000", 8.0),
        Datapoint("2024-01-01T03:00:00.300000", 7.0),
    ]
    _index.put(dataset_id, datapoints1)

    datapoints2 = [
        Datapoint("2024-01-01T03:00:00.400000", 10.0),
        Datapoint("2024-01-01T03:00:00.500000", 9.0),
        Datapoint("2024-01-01T03:00:00.600000", 8.0),
        Datapoint("2024-01-01T03:00:00.700000", 7.0),
    ]
    _index.put(dataset_id, datapoints2)

    datapoints3 = [
        Datapoint("2024-01-01T03:00:00.800000", 10.0),
        Datapoint("2024-01-01T03:00:00.900000", 9.0),
        Datapoint("2024-01-01T03:00:01", 8.0),
        Datapoint("2024-01-01T03:00:01.100000", 7.0),
    ]
    _index.put(dataset_id, datapoints3)

    all_datapoints = datapoints1 + datapoints2 + datapoints3

    start_dt = datetime.fromisoformat("2024-01-01T03:00:00")
    end_dt = datetime.fromisoformat("2024-01-01T03:05:00")

    retrieved_points = _index.get(dataset_id, start_dt, end_dt, Fidelity.FIDELITY_FULL)
    assert set(all_datapoints) == set(retrieved_points)

    retrieved_points = _index.get(dataset_id, start_dt, end_dt, Fidelity.FIDELITY_1)
    assert len(retrieved_points) == 2
    p0 = retrieved_points[0]
    assert p0.date == "2024-01-01T03:00:00"
    assert p0.min_value == pytest.approx(7.0)
    assert p0.max_value == pytest.approx(10.0)
    assert p0.mean_value == pytest.approx(8.7)
    p1 = retrieved_points[1]
    assert p1.date == "2024-01-01T03:00:01"
    assert p1.min_value == pytest.approx(7.0)
    assert p1.max_value == pytest.approx(8.0)
    assert p1.mean_value == pytest.approx(7.5)


def test_empty_queries(tmpdir: str):
    """
    Test all the ways one can ask for data that's not there.
    """
    tmppath = pathlib.Path(tmpdir)
    _index = index.Index(tmppath)

    start_dt = datetime.fromisoformat("2024-01-01T03:00:00")
    end_dt = datetime.fromisoformat("2024-01-01T03:05:00")

    # Query before there's any data.
    datapoints = _index.get("aaa", start_dt, end_dt, fidelity=Fidelity.FIDELITY_FULL)
    assert datapoints == []

    dataset_id = "test_empty_queries"
    datapoints = [
        Datapoint("2024-01-01T02:00:00.800000", 10.0),
    ]
    _index.put(dataset_id, datapoints)

    # Query for a different dataset
    ret = _index.get("aaa", start_dt, end_dt, fidelity=Fidelity.FIDELITY_FULL)
    assert ret == []

    # Query outside the time range of the previous dataset.
    ret = _index.get(dataset_id, start_dt, end_dt, fidelity=Fidelity.FIDELITY_FULL)
    assert ret == []

    # Aggregated query outside the time range of the previous dataset.
    ret = _index.get(dataset_id, start_dt, end_dt, fidelity=Fidelity.FIDELITY_1)
    assert ret == []

    # Valid query just to ensure the data was actually added.
    start_dt = datetime.fromisoformat("2024-01-01T02:00:00")
    end_dt = datetime.fromisoformat("2024-01-01T02:05:00")
    ret = _index.get(dataset_id, start_dt, end_dt, fidelity=Fidelity.FIDELITY_FULL)
    assert datapoints == ret


def test_query_datasets(tmpdir: str):
    """
    Test querying for available datasets.
    """
    tmppath = pathlib.Path(tmpdir)
    _index = index.Index(tmppath)

    # Nothing has been indexed yet.
    ret = _index.datasets("")
    assert ret == []

    # Add some data.
    datasets = ["test_query1", "test_query2", "test_query3"]
    for dataset_id in datasets:
        datapoints = [Datapoint("2024-01-01T03:00:00", 10.0)]
        _index.put(dataset_id, datapoints)

    ret = _index.datasets("")
    assert set(ret) == set(datasets)

    ret = _index.datasets("query")
    assert set(ret) == set(datasets)

    ret = _index.datasets("1")
    assert ret == ["test_query1"]
    ret = _index.datasets("2")
    assert ret == ["test_query2"]
    ret = _index.datasets("3")
    assert ret == ["test_query3"]
    ret = _index.datasets("4")
    assert ret == []


def test_large_put(tmpdir: str):
    """
    Test inserting a 'larger' amount of data, say 10k datapoints for 5 datasets.
    """
    tmppath = pathlib.Path(tmpdir)
    _index = index.Index(tmppath)
    dataset_ids = [f"test_large_put{i}" for i in range(5)]

    start_dt = datetime.fromisoformat("2024-01-01T02:00:00")
    end_dt = datetime.fromisoformat("2024-01-01T03:00:00")

    # Put 5000 points
    timestamps: list[datetime] = []
    for i in range(5000):
        timestamps.append(start_dt + timedelta(milliseconds=i * 100))
    for dataset_id in dataset_ids:
        datapoints = [Datapoint(dt.isoformat(), dt.timestamp()) for dt in timestamps]
        _index.put(dataset_id, datapoints)

    # Put 5000 more points
    next_dt = timestamps[-1]
    timestamps: list[datetime] = []
    for i in range(5000):
        timestamps.append(next_dt + timedelta(milliseconds=i * 100))
    for dataset_id in dataset_ids:
        datapoints = [Datapoint(dt.isoformat(), dt.timestamp()) for dt in timestamps]
        _index.put(dataset_id, datapoints)

    ret_datasets = _index.datasets("test_large_put")
    assert set(ret_datasets) == set(dataset_ids)

    # Read them back
    for dataset_id in dataset_ids:
        datapoints = _index.get(
            dataset_id, start_dt, end_dt, fidelity=Fidelity.FIDELITY_FULL
        )
        assert len(datapoints) == 10000
