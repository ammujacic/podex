"""Middleware modules for the compute service."""

from .script_injector import inject_devtools_script, should_inject_script

__all__ = ["inject_devtools_script", "should_inject_script"]
