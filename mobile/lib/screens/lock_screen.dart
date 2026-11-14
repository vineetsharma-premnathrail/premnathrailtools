import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../auth/app_lock.dart';
import '../auth/auth_service.dart';
import '../theme.dart';
import '../ui/widgets.dart';

/// The portal's app password lock screen. Covers every screen while the
/// session is locked; also the first-time "Set app password" and the reset
/// after an emailed temporary password.
class LockScreen extends StatefulWidget {
  const LockScreen({super.key});

  @override
  State<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<LockScreen> {
  final _pw = TextEditingController();
  final _pw2 = TextEditingController();
  bool _busy = false;
  bool _hide = true;
  String? _error;
  String? _info;
  bool _bioAvailable = false;
  bool _askedBio = false;

  AppLock get lock => AppLock.instance;

  @override
  void initState() {
    super.initState();
    lock.biometricAvailable().then((v) {
      if (!mounted) return;
      setState(() => _bioAvailable = v);
      // Offer the fingerprint straight away, like the phone's own unlock.
      if (v && lock.biometricEnabled && !lock.needsNewPassword) _fingerprint();
    });
  }

  @override
  void dispose() {
    _pw.dispose();
    _pw2.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await action();
    } on DioException catch (e) {
      _error = ApiClient.describe(e);
    } catch (e) {
      _error = e is String ? e : ApiClient.describe(e);
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _unlock() => _run(() async {
        final pw = _pw.text;
        if (pw.isEmpty) throw 'Enter your app password.';
        // Keep the lock screen up until the fingerprint question is answered.
        await lock.unlock(pw, hold: true);
        if (lock.pendingState == 'reset') {
          lock.commit();
          _pw.clear();
          _info = 'Temporary password accepted. Now set a new app password.';
          return;
        }
        try {
          await _offerFingerprint(pw);
        } finally {
          lock.commit();
        }
      });

  Future<void> _set() => _run(() async {
        final pw = _pw.text;
        if (pw.length < lock.minLength) throw 'The app password must be at least ${lock.minLength} characters.';
        if (pw != _pw2.text) throw 'The two passwords are not the same - type them again.';
        await lock.setPassword(pw, hold: true);
        try {
          await _offerFingerprint(pw);
        } finally {
          lock.commit();
        }
      });

  Future<void> _offerFingerprint(String pw) async {
    if (_askedBio || !_bioAvailable || lock.biometricEnabled || !mounted) return;
    _askedBio = true;
    final yes = await confirmDialog(
      context,
      title: 'Use fingerprint to unlock?',
      message: 'Next time the app is locked, unlock it with your fingerprint instead of typing the app password. '
          'Your app password stays protected in this phone\'s secure storage.',
      confirmLabel: 'Use fingerprint',
    );
    if (yes) await lock.enableBiometric(pw);
  }

  Future<void> _fingerprint() => _run(() async {
        final msg = await lock.unlockWithBiometric();
        if (msg != null) throw msg;
      });

  Future<void> _forgot() => _run(() async {
        final to = await lock.forgot();
        _info = 'A temporary password was emailed to $to. Enter it here (it works once, for 15 minutes), '
            'then set a new app password.';
      });

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: lock,
      builder: (context, _) {
        final setNew = lock.needsNewPassword;
        final title = !lock.hasPassword
            ? 'Set your app password'
            : setNew
                ? 'Set a new app password'
                : 'Premnath ERP is locked';
        final subtitle = !lock.hasPassword
            ? 'A short password of your own, asked after login and when the app has been idle. '
                'It protects your account if someone else uses your phone.'
            : setNew
                ? 'Choose a new app password.'
                : (lock.lockMessage ?? 'Enter your app password to continue.');
        final user = AuthService.instance.user ?? const {};
        return Scaffold(
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Image.asset('assets/logo.png', height: 44, semanticLabel: 'Premnath Rail'),
                ),
                const SizedBox(height: 32),
                const Icon(Icons.lock_outline_rounded, size: 40, color: Brand.primary),
                const SizedBox(height: 12),
                Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
                const SizedBox(height: 6),
                Text(subtitle, style: const TextStyle(fontSize: 14, color: Brand.muted)),
                if ((user['name'] as String?)?.isNotEmpty == true) ...[
                  const SizedBox(height: 4),
                  Text('Logged in as ${user['name']}', style: const TextStyle(fontSize: 13, color: Brand.muted)),
                ],
                const SizedBox(height: 24),
                if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 12)],
                if (_info != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                        color: Brand.primarySoft, borderRadius: BorderRadius.circular(12)),
                    child: Text(_info!, style: const TextStyle(color: Brand.body)),
                  ),
                  const SizedBox(height: 12),
                ],
                TextField(
                  controller: _pw,
                  obscureText: _hide,
                  autofocus: !(lock.biometricEnabled && !setNew),
                  textInputAction: setNew ? TextInputAction.next : TextInputAction.done,
                  onSubmitted: (_) => setNew ? null : _unlock(),
                  decoration: InputDecoration(
                    labelText: setNew ? 'New app password' : 'App password',
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      onPressed: () => setState(() => _hide = !_hide),
                    ),
                  ),
                ),
                if (setNew) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _pw2,
                    obscureText: _hide,
                    onSubmitted: (_) => _set(),
                    decoration: const InputDecoration(labelText: 'Type it again', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 6),
                  Text('At least ${lock.minLength} characters.',
                      style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : (setNew ? _set : _unlock),
                  child: _busy
                      ? const SizedBox(
                          width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(setNew ? 'Save app password' : 'Unlock'),
                ),
                if (!setNew && _bioAvailable && lock.biometricEnabled) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    onPressed: _busy ? null : _fingerprint,
                    icon: const Icon(Icons.fingerprint_rounded),
                    label: const Text('Unlock with fingerprint'),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    if (lock.hasPassword && lock.state != 'reset')
                      TextButton(onPressed: _busy ? null : _forgot, child: const Text('Forgot app password?'))
                    else
                      const SizedBox.shrink(),
                    TextButton(
                      onPressed: _busy ? null : () => AuthService.instance.signOut(),
                      child: const Text('Logout'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
