"""
Public HTTP API dataclasses
"""

from dataclasses import dataclass


@dataclass(eq=True, frozen=True)
class Datapoint:
    date: str
    value: float


@dataclass(eq=True, frozen=True)
class AggregatedDatapoint:
    date: str
    min_value: float
    mean_value: float
    max_value: float


@dataclass
class TimeSeriesDataset:
    dataset: str
    points: list[Datapoint | AggregatedDatapoint]
