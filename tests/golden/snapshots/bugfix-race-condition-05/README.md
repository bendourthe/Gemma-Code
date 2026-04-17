# bugfix-race-condition-05

Two async functions share a mutable counter without synchronization. Add a simple async mutex so concurrent increments are serialized.
