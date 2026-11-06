import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'auth/auth_service.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('en_IN');
  runApp(const PremnathApp());
}

class PremnathApp extends StatelessWidget {
  const PremnathApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Premnath ERP',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: const _AuthGate(),
    );
  }
}

/// Splash while the saved Microsoft account signs in silently, then login or home.
class _AuthGate extends StatefulWidget {
  const _AuthGate();

  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> {
  late final Future<void> _restoring = AuthService.instance.restore();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: _restoring,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        return ListenableBuilder(
          listenable: AuthService.instance,
          builder: (context, _) =>
              AuthService.instance.isSignedIn ? const HomeShell() : const LoginScreen(),
        );
      },
    );
  }
}
