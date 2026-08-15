"""Probe: builds the module name at runtime. The prover must reject this one."""
import importlib

bridge = importlib.import_module("tablegrab" + "_bridge")
