"""
API for the various data fidelities.
"""

from enum import Enum


class Fidelity(Enum):
    FIDELITY_FULL = 0
    FIDELITY_1 = 1  # 1 second
    FIDELITY_10 = 2  # 10 seconds
    FIDELITY_100 = 3  # Roughly 1.5 minutes
    FIDELITY_1000 = 4  # Roughly 15 minutes
    FIDELITY_10000 = 5  # Roughly 3 hours
    FIDELITY_100000 = 6  # Roughly daily
