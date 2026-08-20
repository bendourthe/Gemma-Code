# Headless JSON CLI (v2.1.0 Phase 6)

The `nexus` CLI talks to the running sidecar over the shared loopback control surface (`127.0.0.1:11500` by default) using the existing `nexus.serving.token`. There is no second HTTP server and no second credential.

Enable Settings > Local API server (or ACP) so the listener is bound. Then:

```
nexus session new --json "{\"modelId\":\"gemma4:e4b\"}"
nexus session send --json "{\"sessionId\":\"...\",\"text\":\"list the repo layout\"}"
nexus session list
nexus models list
nexus generate queue --json "{\"pillar\":\"image\",\"jobType\":\"txt2img\",\"parameters\":{\"prompt\":\"a fox\"}}"
nexus generate status --id <jobId>
```

Auth: `--token`, `NEXUS_SERVING_TOKEN`, or `nexus.serving.token` in `~/.nexus/settings.json`. Host/port: `--host` / `--port` or `NEXUS_SERVING_HOST` / `NEXUS_SERVING_PORT`.

Exit codes: `0` success, `1` sidecar down or auth failure, `2` usage or JSON schema error. Schema failures never touch the network. Output is always one JSON object on stdout.

Routes live at `/nexus/*`, not `/v1/*`, so the OpenAI serving gateway cannot 404 them.
