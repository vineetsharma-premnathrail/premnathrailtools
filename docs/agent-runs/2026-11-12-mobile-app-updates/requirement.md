# Mobile app: download page + automatic and in-app self-update

Date: 2026-11-12 · Size: L (new table, backend + portal + Android app, upload/download) · Owner request in chat.

## Requirement (business words)
Employees install the private Android app (no Play Store, no Intune - owner ruled out Option 3) from a portal download page. New versions must reach every phone automatically, and the app must also offer an "App update" option the person can open to check and update at once.

Core-flow position: platform (all modules) - distribution of the mobile client.

## Decisions (owner + Manager, reversible)
- Distribution = portal download page (logged-in) + in-app updater. APK is served only by our backend behind login; integrity by SHA-256 computed on the server at upload.
- Storage = SharePoint (same as every other ERP file), not the DB, not the Docker image.
- Who publishes a version = portal admins only (Organization › Mobile App page). Each release: APK file, version name, version code (must be higher than the latest), what's new, "update required" switch, active switch.
- Auto-update: app checks on start and every 6 h while open; downloads in the background, verifies SHA-256, installs. Android 12+ allows silent self-update after the app has updated itself once (PackageInstaller USER_ACTION_NOT_REQUIRED); otherwise / on Xiaomi the system asks once ("Install"). To avoid killing the app mid-work, an automatic install runs when the app goes to the background or at the next start; "Update now" installs immediately.
- Required update: app blocks with "Please update to continue" until updated.
- Manual: Profile popup › "App update": current version, Check for updates, Update now with progress, what's new.
- Out of scope now: per-user installed-version statistics (phase 2), iOS.
- Release signing key + production build are separate release steps (need owner OK).
