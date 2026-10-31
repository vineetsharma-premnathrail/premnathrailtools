import 'package:flutter/material.dart';
import 'package:msal_auth/msal_auth.dart';

import '../api/api_client.dart';
import '../auth/auth_service.dart';
import '../config.dart';
import '../theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AuthService.instance.signIn();
    } on MsalUserCancelException {
      // User closed the Microsoft page; nothing to report.
    } on MsalException catch (e) {
      _error = 'Microsoft login failed: ${e.message}. '
          'Try again with your company account (@premnathrail.com).';
    } catch (e) {
      _error = ApiClient.describe(e);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final missing = AppConfig.missingSettings;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(flex: 2),
              Image.asset(
                'assets/logo.png',
                height: 56,
                alignment: Alignment.centerLeft,
                semanticLabel: 'Premnath Rail',
              ),
              const SizedBox(height: 28),
              const Text(
                'ERP',
                style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Brand.heading),
              ),
              const SizedBox(height: 8),
              const Text(
                'The complete Premnath Rail ERP on your phone.',
                style: TextStyle(fontSize: 15, color: Brand.muted),
              ),
              const Spacer(flex: 3),
              if (missing.isNotEmpty)
                _Banner(
                  'App setup is incomplete: ${missing.join(', ')} not set. '
                  'Fill in mobile/env/dev.json and run the app with '
                  '"--dart-define-from-file=env/dev.json".',
                ),
              if (_error != null) _Banner(_error!),
              FilledButton.icon(
                onPressed: _busy || missing.isNotEmpty ? null : _signIn,
                icon: _busy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.login_rounded),
                label: Text(_busy ? 'Logging in…' : 'Login with Microsoft'),
              ),
              const SizedBox(height: 12),
              const Text(
                'Use the same company account you use for the portal.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: Brand.muted),
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner(this.message);
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Brand.dangerSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Brand.danger.withValues(alpha: 0.3)),
      ),
      child: Text(message, style: const TextStyle(color: Brand.danger, fontSize: 14)),
    );
  }
}
