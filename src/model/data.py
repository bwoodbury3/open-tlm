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
class Dataset:
    id: str
    name: str
    tags: list[str]


@dataclass
class TimeSeriesDataset:
    dataset: Dataset
    points: list[Datapoint | AggregatedDatapoint]
