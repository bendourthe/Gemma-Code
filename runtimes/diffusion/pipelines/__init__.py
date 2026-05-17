"""Pipeline implementations for the Nexus diffusion runtime.

Each module in this package exposes a `register(handlers)` function that
registers the pipeline's JSON-RPC method with the dispatcher. The base
module supplies the smart-offload helper, the parameter validation
layer, and the PIL-backed PNG output writer so individual pipelines stay
short and focused.
"""
