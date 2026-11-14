import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../theme.dart';
import '../ui/app_frame.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';
import 'app_updater.dart';

/// "Update now" from any screen: downloads (if needed) and installs. When
/// Android's "Install unknown apps" setting is off for this app, explains it
/// and opens the setting - the update goes on when the person comes back.
Future<void> startUpdate(BuildContext context) async {
  final up = AppUpdater.instance;
  final ok = await up.updateNow();
  if (ok || !context.mounted) return;
  final yes = await confirmDialog(
    context,
    title: 'Allow updates for Premnath ERP',
    message: 'Android needs your OK once before this app can install its own updates.\n\n'
        'On the next screen, turn on "Allow from this source" for Premnath ERP, then come back here - '
        'the update continues by itself.',
    confirmLabel: 'Open settings',
  );
  if (yes) await up.openInstallSettings();
}

String fmtFileSize(int bytes) {
  if (bytes <= 0) return '';
  const mb = 1024 * 1024;
  if (bytes >= mb) return '${(bytes / mb).toStringAsFixed(1)} MB';
  return '${(bytes / 1024).ceil()} KB';
}

/// Profile › App update: this phone's version, Check for updates, the new
/// version's details and Update now with progress.
class UpdateScreen extends StatefulWidget {
  const UpdateScreen({super.key});

  @override
  State<UpdateScreen> createState() => _UpdateScreenState();
}

class _UpdateScreenState extends State<UpdateScreen> {
  AppUpdater get up => AppUpdater.instance;

  @override
  void initState() {
    super.initState();
    // Fresh answer whenever the screen is opened (unless one is running).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !up.busy) up.check();
    });
  }

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'App update',
      body: ListenableBuilder(
        listenable: up,
        builder: (context, _) {
          final r = up.latest;
          return ListView(
            padding: const EdgeInsets.only(top: 16, bottom: 24),
            children: [
              DetailSection('This phone', children: [
                Row(
                  children: [
                    const Icon(Icons.phone_android_rounded, color: Brand.muted, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(up.currentLabel.isEmpty ? 'Premnath ERP' : 'Premnath ERP ${up.currentLabel}',
                              style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                          if (up.lastCheck != null) ...[
                            const SizedBox(height: 2),
                            Text('Last checked ${fmtDateTime(up.lastCheck!.toIso8601String())}',
                                style: const TextStyle(fontSize: 12, color: Brand.muted)),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ]),
              if (up.state == UpdateState.checking && !up.hasUpdate)
                const _StatusLine(
                    icon: Icons.sync_rounded, color: Brand.muted, text: 'Checking for updates…', spinner: true)
              else if (!up.hasUpdate && up.lastCheck != null && up.state != UpdateState.error)
                const _StatusLine(
                    icon: Icons.check_circle_rounded, color: Brand.success, text: 'You have the latest version'),
              if (up.hasUpdate && r != null)
                DetailSection(
                  'Version ${r.versionName.isEmpty ? r.versionCode : r.versionName} available',
                  action: up.mustUpdate ? const StatusBadge('Required', color: Brand.danger) : null,
                  children: [_ReleaseDetails(release: r)],
                ),
              if (up.needsInstallPermission && up.hasUpdate) const _PermissionNote(),
              if (up.message != null && up.state != UpdateState.downloading)
                Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(up.message!)),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (up.hasUpdate) ...[
                      _UpdateButton(),
                      const SizedBox(height: 10),
                    ],
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                      onPressed: up.busy ? null : () => up.check(),
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Check for updates'),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.icon, required this.color, required this.text, this.spinner = false});
  final IconData icon;
  final Color color;
  final String text;
  final bool spinner;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              if (spinner)
                const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
              else
                Icon(icon, color: color, size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Text(text, style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Released date, size, what's new, and the download/install progress.
class _ReleaseDetails extends StatelessWidget {
  const _ReleaseDetails({required this.release});
  final AppRelease release;

  @override
  Widget build(BuildContext context) {
    final up = AppUpdater.instance;
    final facts = [
      if (release.releasedAt != null) 'Released ${fmtDate(release.releasedAt!.toIso8601String())}',
      if (release.fileSize > 0) fmtFileSize(release.fileSize),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (facts.isNotEmpty)
          Text(facts.join('  ·  '), style: const TextStyle(fontSize: 12, color: Brand.muted)),
        if (release.notes.trim().isNotEmpty) ...[
          const SizedBox(height: 10),
          const Caps('What\'s new'),
          const SizedBox(height: 4),
          Text(release.notes.trim(), style: const TextStyle(color: Brand.body, height: 1.35)),
        ],
        const SizedBox(height: 10),
        _Progress(up: up),
      ],
    );
  }
}

class _Progress extends StatelessWidget {
  const _Progress({required this.up});
  final AppUpdater up;

  @override
  Widget build(BuildContext context) {
    switch (up.state) {
      case UpdateState.downloading:
        final p = up.progress;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(value: p, minHeight: 8, backgroundColor: Brand.primarySoft),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: Text(p == null ? 'Downloading…' : 'Downloading… ${(p * 100).round()}%',
                      style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ),
                TextButton(onPressed: up.cancelDownload, child: const Text('Cancel')),
              ],
            ),
          ],
        );
      case UpdateState.readyToInstall:
        return const Text(
            'Downloaded. It installs by itself when you leave the app, or tap Update now to install it at once.',
            style: TextStyle(fontSize: 12, color: Brand.muted));
      case UpdateState.installing:
        return const Row(
          children: [
            SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            SizedBox(width: 10),
            Expanded(
              child: Text('Installing… If Android asks, tap Install. The app closes and opens in the new version.',
                  style: TextStyle(fontSize: 12, color: Brand.muted)),
            ),
          ],
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

class _UpdateButton extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final up = AppUpdater.instance;
    final working = up.state == UpdateState.downloading || up.state == UpdateState.installing;
    return FilledButton.icon(
      onPressed: working ? null : () => startUpdate(context),
      icon: const Icon(Icons.system_update_rounded),
      label: Text(up.state == UpdateState.downloading
          ? 'Downloading…'
          : up.state == UpdateState.installing
              ? 'Installing…'
              : 'Update now'),
    );
  }
}

class _PermissionNote extends StatelessWidget {
  const _PermissionNote();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Brand.primarySoft, borderRadius: BorderRadius.circular(12)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Android has not yet allowed Premnath ERP to install its updates. Turn on "Allow from this source" '
                'once, then come back - the update continues by itself.',
                style: TextStyle(color: Brand.body)),
            const SizedBox(height: 6),
            TextButton(
              style: TextButton.styleFrom(padding: EdgeInsets.zero),
              onPressed: () => AppUpdater.instance.openInstallSettings(),
              child: const Text('Open settings'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Covers the whole app (like the lock screen) while an update is required:
/// the only ways out are updating or Logout.
class RequiredUpdateScreen extends StatelessWidget {
  const RequiredUpdateScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final up = AppUpdater.instance;
    return PopScope(
      canPop: false,
      child: Scaffold(
        body: SafeArea(
          child: ListenableBuilder(
            listenable: up,
            builder: (context, _) {
              final r = up.latest;
              final name = r == null ? '' : (r.versionName.isEmpty ? '${r.versionCode}' : r.versionName);
              return ListView(
                padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Image.asset('assets/logo.png', height: 44, semanticLabel: 'Premnath Rail'),
                  ),
                  const SizedBox(height: 32),
                  const Icon(Icons.system_update_rounded, size: 40, color: Brand.primary),
                  const SizedBox(height: 12),
                  const Text('Please update to continue',
                      style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
                  const SizedBox(height: 6),
                  Text(
                    'This version of Premnath ERP can no longer be used. Install version $name to keep working - '
                    'it takes about a minute.',
                    style: const TextStyle(fontSize: 14, color: Brand.muted),
                  ),
                  if (up.currentLabel.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text('On this phone: ${up.currentLabel}', style: const TextStyle(fontSize: 13, color: Brand.muted)),
                  ],
                  const SizedBox(height: 20),
                  if (r != null) ...[
                    Card(
                      child: Padding(padding: const EdgeInsets.all(14), child: _ReleaseDetails(release: r)),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (up.needsInstallPermission) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: Brand.primarySoft, borderRadius: BorderRadius.circular(12)),
                      child: const Text(
                          'Android has not yet allowed Premnath ERP to install its updates. Tap Update now, '
                          'turn on "Allow from this source", then come back.',
                          style: TextStyle(color: Brand.body)),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (up.message != null && up.state != UpdateState.downloading) ...[
                    ErrorBanner(up.message!),
                    const SizedBox(height: 12),
                  ],
                  _UpdateButton(),
                  const SizedBox(height: 16),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: up.state == UpdateState.installing ? null : () => AuthService.instance.signOut(),
                      child: const Text('Logout'),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
