"""
Unit tests for the indexer/aggregation library.
"""

from datetime import datetime
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

    for file in tmppath.rglob("*"):
        if file.is_file():
            print(file)

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
