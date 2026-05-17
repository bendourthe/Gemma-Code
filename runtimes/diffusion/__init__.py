"""Nexus diffusion runtime package.

The package boundary keeps PyTorch + diffusers imports out of the
entrypoint module so `python -m runtimes.diffusion.main` can probe
device capabilities without paying the deep-import cost.
"""
