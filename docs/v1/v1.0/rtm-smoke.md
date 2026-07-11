# v1.0.0 -- Release-To-Manufacturing (RTM) smoke checklist

**Audience**: release operator.
**Plan reference**: [phase-11-hardening-and-release.md](plans/phase-11-hardening-and-release.md) sub-task 11.6.
**Budget**: 90 minutes from install-click to all-pillars-verified on a clean Windows 11 VM with the recommended models downloaded fresh; 20 minutes if the recommended models are pre-cached locally and copied into the VM before the run.
**Recording**: append the result, the wall-clock timings, and any anomalies to `docs/versions/v1/v1.0.0/operator-actions.md` (Section: "OA-04 RTM smoke execution").

---

## 0. Pre-flight (off the VM)

- [ ] Build `Nexus-1.0.0-Setup.exe` via `installer-build.yml` (workflow_dispatch with `release=true`). Verify the artifact is Authenticode-signed (per `release-signing.md`).
- [ ] Stage a fresh Windows 11 VM (Hyper-V, Parallels, or VMware) -- 16 GB RAM minimum, attached or pass-through RTX 4070 (or equivalent 12 GB+ NVIDIA GPU).
- [ ] VM has internet access. Do NOT install Python, Node, CUDA, Ollama, or any model files manually -- the installer provisions everything.
- [ ] Stopwatch ready. Start the stopwatch at step 2 (installer launch).

## 1. Acquire the installer

- [ ] Download `Nexus-1.0.0-Setup.exe` from `https://github.com/bendourthe/Nexus-AI/releases/tag/v1.0.0` via Edge on the VM.
- [ ] Right-click -> Properties -> Digital Signatures: verify "Verified publisher: <Org Name>" is present.
- [ ] Note the SmartScreen reputation status (on a freshly-signed installer, expect "Verified publisher" with no "More info" warning; if early in the certificate's life, SmartScreen may show "Unknown publisher" until reputation accrues).

## 2. Run the installer

**Start stopwatch.**

- [ ] Double-click `Nexus-1.0.0-Setup.exe`.
- [ ] UAC prompt: click Yes.
- [ ] Wizard Welcome page: click Next.
- [ ] EULA: scroll, accept, click Next.
- [ ] Components: leave defaults (CUDA on, Python venv on, Node on, Ollama on, DevAI-Hub baseline on). Click Next.
- [ ] CUDA provisioner: confirms an NVIDIA driver is present; downloads + installs the CUDA 12.x runtime. Verify the page reports "CUDA 12.x available" before Next.
- [ ] Python venv: provisions `~/.nexus/runtimes/diffusion/.venv/` with pinned wheels. Verify "venv ready" before Next.
- [ ] Node: provisions Node 22 portable at `~/.nexus/runtimes/node/`. Verify "Node 22 ready" before Next.
- [ ] Ollama: installs Ollama and starts the service. Verify "Ollama service running" before Next.
- [ ] Recommended models: pick "Recommended" preset (Gemma 4 e4b + Llama 3.1 8b + SDXL Turbo + LTX-Video). Click Next.
- [ ] Install: progress bar advances; model downloads run in parallel where possible. Wait for "Install complete".
- [ ] Done page: click Finish.
- [ ] Record install duration: from UAC prompt to Done page click. Target: <= 60 minutes on a fresh download, <= 10 minutes if models pre-cached.

## 3. Launch and dashboard

- [ ] Double-click the Nexus Desktop shortcut on the desktop.
- [ ] The Tauri window opens to the Dashboard.
- [ ] Verify all four module cards render (Coding, Chat, Image, Video).
- [ ] Verify the `<LocalModelStatus>` widget at the bottom-right shows the GPU model + total VRAM. (If it reports "No GPU detected", check that the VM has GPU pass-through and that `nvidia-smi` runs from a terminal.)
- [ ] Verify the TopBar search input responds to typing.

## 4. Coding module

- [ ] Click the Coding card.
- [ ] In the chat input, type: `create a hello world Python script at hello.py and verify it runs`.
- [ ] Hit Enter. The agent should: open a turn, call `apply_edit` to write `hello.py`, then call a tool to run it (or instruct the user to run it).
- [ ] Verify `hello.py` exists in the workspace and contains a working `print("Hello, World!")`.
- [ ] Verify the trace dashboard (sidebar -> Coding -> Trace) shows the tool-call timeline.
- [ ] Record time-to-first-token from prompt submission. Target: <= 5 s.

## 5. Chat module

- [ ] Click the Chat card.
- [ ] In the FolderTree, click "+ Folder" and create a folder named `Test`.
- [ ] Right-click the `Test` folder -> "New chat". Name it `Smoke`.
- [ ] In the message input, send: `what is 2+2?`.
- [ ] Verify the assistant replies with `4` (or an equivalent answer).
- [ ] Verify the chat persists across an app restart (close Nexus, relaunch, navigate to Chat -> Test -> Smoke, confirm the message history is intact).

## 6. Image Studio

- [ ] Click the Image card.
- [ ] In the prompt form, enter: `a serene mountain landscape at sunset, photorealistic`.
- [ ] Model dropdown: select `SDXL Turbo`. Resolution: 1024x1024. Steps: 4 (Turbo default). Sampler: euler. Seed: leave at random.
- [ ] Click Generate.
- [ ] Verify the live latent preview shows progress.
- [ ] Verify the generated image lands in the output gallery within 30 seconds (RTX 4070 baseline).
- [ ] Right-click the output -> "Copy Workflow". Open a text editor and paste -- verify a JSON blob with the prompt, model, sampler, steps, seed is present.

## 7. Video Lab

- [ ] Click the Video card.
- [ ] Mode toggle: text2video.
- [ ] Prompt: `ocean waves rolling onto a beach, gentle, sunset, slow motion`.
- [ ] Model dropdown: select `LTX-Video`. Duration: 4 seconds. FPS: 24. Resolution: 480p.
- [ ] Click Generate.
- [ ] Verify the thumbnail strip updates as the pipeline progresses.
- [ ] Verify the MP4 lands in the output gallery within 5 minutes (RTX 4070 baseline).
- [ ] Click the output to load it into the timeline previewer. Scrub the playhead. Confirm playback works.

## 8. Settings -> Skills sync

- [ ] Open Settings (cog icon in Sidebar) -> Skills.
- [ ] Verify the upstream tag is shown (e.g., `bendourthe/DevAI-Hub@v1.0.0-baseline`).
- [ ] Click "Sync now".
- [ ] Verify the progress indicator runs and "Last synced: <timestamp>" updates.
- [ ] Verify the SkillList includes at least 5 skills under the `devai-hub/` namespace.
- [ ] Pick any skill, click "Use as default" if it shows a "Diverged" badge. Confirm the badge updates.

## 9. Restart and persistence

- [ ] Close Nexus (window X).
- [ ] Wait 10 seconds (let the sidecar shutdown handler complete).
- [ ] Relaunch.
- [ ] Verify: Dashboard renders, the previous Coding session is in the session list, the Chat folder tree is intact, the Image Studio gallery shows the mountain landscape, the Video Lab gallery shows the ocean clip, Settings -> Skills shows the synced upstream tag.

## 10. Uninstall (data-preservation check)

- [ ] Start menu -> Nexus -> Uninstall Nexus (or Settings -> Apps -> Nexus -> Uninstall).
- [ ] On the uninstall dialog, when prompted "Delete user data at ~/.nexus/?" -- click NO.
- [ ] Verify after uninstall: `%LOCALAPPDATA%\Nexus\` is removed (binaries gone), `~/.nexus/` is preserved (user data intact).
- [ ] Re-run the installer (same `Nexus-1.0.0-Setup.exe`).
- [ ] Verify on next launch: the user data is detected and the dashboard shows the previous sessions.

## 11. Repeat with data deletion

- [ ] Uninstall again, this time clicking YES on the data-preservation prompt.
- [ ] Verify both `%LOCALAPPDATA%\Nexus\` and `~/.nexus/` are removed.

## 12. Recording

Append to `docs/versions/v1/v1.0.0/operator-actions.md` under "OA-04 RTM smoke execution":

```
## RTM smoke -- <YYYY-MM-DD>

| Phase | Time | Notes |
|---|---|---|
| Installer (UAC -> Done) | NN min | |
| First launch -> Dashboard | NN s | |
| Coding /create hello.py | NN s | first-token at NN ms |
| Chat 2+2 round-trip | NN s | |
| Image SDXL Turbo 1024x1024 | NN s | |
| Video LTX 4s @ 24fps @ 480p | NN min | |
| Skills sync | NN s | tag: <commit-sha> |
| Restart + persistence | passed | |
| Uninstall preserve-data | passed | |
| Uninstall delete-data | passed | |

**Anomalies**: <free-text>
**Result**: PASS / FAIL
```

Any anomalies become P3 known-gaps for v1.0.1, recorded in `docs/versions/v1/v1.0.1/known-gaps.md` once that file opens.
