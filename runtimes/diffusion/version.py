"""Runtime + protocol versions for the diffusion sidecar.

`RUNTIME_VERSION` matches the Nexus shell semver. `PROTOCOL_VERSION`
bumps independently when the JSON-RPC contract gains a breaking
change so the Node sidecar can refuse to talk to a stale Python
process.
"""

RUNTIME_VERSION = "1.0.0-alpha.0"
PROTOCOL_VERSION = "1"
