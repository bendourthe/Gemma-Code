# v1.0.0 -- Code signing and notarization runbook

**Audience**: release operator (Benjamin Dourthe initially), CI maintainer.
**Status**: Windows Authenticode signing is the v1.0.0 in-scope target. macOS notarization is documented here and deferred to v1.0.1 per Phase 9.8.
**Plan reference**: [phase-11-hardening-and-release.md](plans/phase-11-hardening-and-release.md) sub-task 11.3.

---

## 1. Windows Authenticode signing

### 1.1 Prerequisites (operator-procured, one-time)

- **EV Code Signing Certificate** issued by a CA recognised by Windows (DigiCert, GlobalSign, Sectigo). EV (Extended Validation) is required for SmartScreen reputation to accrue immediately at first install; OV (Organization Validation) certificates start with zero reputation and warn users for ~30 days.
- **HSM / hardware token** containing the certificate (DigiCert hardware token, YubiKey 5 FIPS, or equivalent). Software-only EV certificates are no longer issued post-2023; the private key must live in an FIPS 140-2 Level 2 (or higher) device.
- **`signtool.exe`** from the Windows 10/11 SDK. Tested with `10.0.22621.0`.
- **GitHub Actions encrypted secrets**:
  - `WINDOWS_SIGNING_THUMBPRINT` -- the certificate thumbprint (visible in the HSM management UI).
  - `WINDOWS_SIGNING_PIN` -- HSM PIN (or, for cloud-signing services like Azure Trusted Signing, the service credentials).

> **Operator action OA-01**: procure the EV certificate, store the HSM in the build environment, populate the two GitHub secrets. Record certificate expiry in the operator-actions log so renewal is not surprise-driven. Without this step, the v1.0.0 Windows installer ships unsigned and SmartScreen reputation does not accrue.

### 1.2 What to sign

The NSIS outer installer is the user-visible binary -- the file Windows surfaces in the SmartScreen dialog -- so it MUST be signed. The bundled binaries inside the installer (the PyQt wizard `nexus-installer.exe`, the Python embeddable, the Node.js runtime, the Nexus desktop binary, any bundled DLLs) SHOULD also be signed before NSIS packaging so the install-time process surfaces a verified publisher rather than chained warnings.

Sign order:

1. `nexus-installer.exe` (PyInstaller-frozen wizard).
2. `nexus.exe` (Tauri desktop binary, built by `cargo tauri build`).
3. Any other native binaries inside `build/payload/` that ship as `.exe` or `.dll`.
4. **Last**: the NSIS-built outer installer `Nexus-1.0.0-Setup.exe`. Signing this last is mandatory; signing it before NSIS packaging is moot because makensis rewrites the binary.

### 1.3 The signing command

```pwsh
signtool sign `
  /tr http://timestamp.digicert.com `
  /td sha256 `
  /fd sha256 `
  /sha1 $env:WINDOWS_SIGNING_THUMBPRINT `
  /a `
  Nexus-1.0.0-Setup.exe
```

Flag reference:

- `/tr <url>` -- RFC 3161 timestamp authority URL. Use DigiCert's (`http://timestamp.digicert.com`) or another reputable TSA. Timestamps make the signature continue to verify after the certificate expires.
- `/td sha256` -- timestamp digest algorithm. SHA-1 is dead; do not use it.
- `/fd sha256` -- file digest algorithm. SHA-256 is the minimum for Authenticode in 2026.
- `/sha1 <thumbprint>` -- selects the cert by thumbprint. With a hardware token, the HSM driver intercepts the private-key operation and prompts for the PIN.
- `/a` -- auto-select the best cert if multiple match (defensive).

### 1.4 Verification

```pwsh
signtool verify /pa /v Nexus-1.0.0-Setup.exe
```

Expected output: `Successfully verified: Nexus-1.0.0-Setup.exe`. The `/pa` flag uses the default Authenticode verification policy; `/v` prints the full cert chain so the operator can confirm the EV cert is the leaf.

On a clean Windows 11 VM, right-click the signed installer -> Properties -> Digital Signatures should show: signature present, signing time present (the TSA timestamp), and the EV publisher name. SmartScreen warnings still trigger on the first few downloads until reputation accrues; the warning text changes from "Unknown publisher" to "Verified publisher: <Org Name>" once the cert is recognised.

### 1.5 CI integration

```yaml
# .github/workflows/installer-build.yml -- Windows sign step (skeleton)
- name: Sign installer
  if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
  env:
    THUMBPRINT: ${{ secrets.WINDOWS_SIGNING_THUMBPRINT }}
  run: |
    signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /sha1 $env:THUMBPRINT /a build\Nexus-1.0.0-Setup.exe
    signtool verify /pa /v build\Nexus-1.0.0-Setup.exe
  shell: pwsh
```

Gate the sign step on tag push so dev builds remain unsigned (signing every PR would burn HSM signature quota and slow CI; the unsigned dev build is still installable for review).

### 1.6 Failure modes

- **HSM not present** -- signtool fails with `SignerSign() failed: 0x80092004 (Cannot find object or property)`. Fix: ensure the HSM driver service is running on the runner; on Azure-hosted Windows runners, use Azure Trusted Signing instead of a physical HSM.
- **Wrong cert algorithm** -- old `/fd sha1` builds fail Authenticode verification on Windows 10+. Always use `sha256`.
- **No timestamp** -- if `/tr` is omitted, the signature stops verifying when the cert expires. Operator-action item: always pass `/tr`.

---

## 2. macOS notarization (deferred to v1.0.1)

The macOS DMG is not built or notarized in v1.0.0 (per Phase 9.8 + known-gap 9.P2.EEE). This section is the v1.0.1 reference.

### 2.1 Prerequisites

- Apple Developer Program membership ($99/year) under the same legal entity that publishes Nexus.
- Apple Developer ID Application certificate (for code signing) and Apple Developer ID Installer certificate (for the DMG / pkg).
- App-specific password for the operator's Apple ID, stored in macOS Keychain or a GitHub Actions secret.
- Team ID (10-character string, visible in Apple Developer portal).
- `xcrun notarytool` (ships with Xcode 13+; Xcode 14+ recommended).

GitHub secrets to provision:

- `APPLE_ID` -- the Apple ID email.
- `APPLE_TEAM_ID` -- the 10-character team identifier.
- `APPLE_APP_SPECIFIC_PASSWORD` -- app-specific password generated at appleid.apple.com.
- `APPLE_DEVELOPER_ID_APPLICATION_CERT` -- the application cert as a base64-encoded `.p12`.
- `APPLE_DEVELOPER_ID_INSTALLER_CERT` -- the installer cert as a base64-encoded `.p12`.

### 2.2 Workflow

```bash
# 1. Sign every Mach-O binary inside the .app bundle (deep sign).
codesign --force --options runtime --timestamp \
  --sign "Developer ID Application: <Org Name> (<TeamID>)" \
  --entitlements desktop/src-tauri/entitlements.plist \
  build/Nexus.app

# 2. Package into a DMG.
hdiutil create -volname "Nexus" -srcfolder build/Nexus.app \
  -ov -format UDZO build/Nexus-1.0.0.dmg

# 3. Sign the DMG.
codesign --sign "Developer ID Application: <Org Name> (<TeamID>)" \
  --timestamp build/Nexus-1.0.0.dmg

# 4. Submit for notarization (synchronous; --wait blocks until Apple replies).
xcrun notarytool submit build/Nexus-1.0.0.dmg \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --wait

# 5. Staple the notarization ticket so Gatekeeper accepts the DMG offline.
xcrun stapler staple build/Nexus-1.0.0.dmg

# 6. Verify locally.
spctl --assess --type install --verbose build/Nexus-1.0.0.dmg
```

Expected `spctl` output: `accepted source=Notarized Developer ID`.

### 2.3 Entitlements

The Tauri shell needs the following entitlements at `desktop/src-tauri/entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

`allow-jit` and `allow-unsigned-executable-memory` are required by the Python sidecar (`runtimes/diffusion/`) because PyTorch's torch.compile / TorchInductor emits JIT'd kernels. `disable-library-validation` is required by the Node sidecar because esbuild-bundled native modules are signed by the npm package author, not by Nexus.

### 2.4 Failure modes

- **Notarization rejected with "hardened runtime not enabled"** -- add `--options runtime` to the `codesign` invocation.
- **Notarization rejected with "missing entitlements"** -- the Python sidecar's PyTorch kernels need JIT entitlements; see 2.3.
- **Stapling fails** -- the DMG was modified after notarization. Re-submit and re-staple, in that order.

---

## 3. Secret management

- All signing secrets live in GitHub Actions encrypted secrets (Settings -> Secrets and variables -> Actions). Never commit a cert, a private key, an Apple-ID, or an HSM PIN to the repository.
- The CI workflow downloads secrets via `${{ secrets.* }}` and exports them to environment variables for the signing step; `set +x` is in effect on every step that touches a secret so the value is not logged.
- Cert renewal: EV Code Signing certs are typically 1-3 year validity; Apple Developer ID certs are 5 years. Calendar both expiries in the operator-actions log so renewals are not surprises.

---

## 4. Validation checklist

Before declaring 11.3 complete:

- [ ] EV Code Signing certificate procured, HSM provisioned, GitHub secrets populated. (Operator action OA-01.)
- [ ] Sign step added to `.github/workflows/installer-build.yml` and gated on tag-push.
- [ ] First signed `Nexus-1.0.0-Setup.exe` produced and verified locally with `signtool verify /pa /v`.
- [ ] Signed installer's Properties -> Digital Signatures dialog shows "Verified publisher: <Org Name>".
- [ ] SmartScreen warning text on a fresh Windows 11 VM reads "Verified publisher" (not "Unknown publisher"); reputation will accrue post-release as more users install.
- [ ] macOS notarization workflow documented; v1.0.1 cycle owns execution.
