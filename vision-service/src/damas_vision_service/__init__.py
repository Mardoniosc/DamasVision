"""Damas Vision local vision service (G3.1, ADR-042).

Implements the app's vision-worker protocol over HTTP: calibration, rectification and
board recognition. It only *observes*: it knows nothing about moves, rules or games.
"""

SERVICE_VERSION = "0.1.0"
#: Version of the JSON contract shared with the Angular app (`BoardRecognitionResult` v1).
CONTRACT_VERSION = 1
